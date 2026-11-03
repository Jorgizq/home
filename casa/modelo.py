"""Construye la casa en Blender a partir de layout.json y hace un render de prueba.

Uso (Blender como módulo de Python, sin abrir Blender):
  python casa/modelo.py casa/layout.json salida.png [--blend casa.blend] [--muestras 48]

Muros = (habitaciones engordadas) − (habitaciones), cortados a CORTE m de altura,
con los huecos de puertas y ventanas recortados por franjas de altura.
"""
import sys, json, math, argparse
import numpy as np, trimesh, bpy
from mathutils import Vector
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union

ap = argparse.ArgumentParser()
ap.add_argument('layout'); ap.add_argument('salida')
ap.add_argument('--blend'); ap.add_argument('--muestras', type=int, default=48)
ap.add_argument('--corte', type=float, default=1.40)
ap.add_argument('--res', default='1600x1200')
ap.add_argument('--sol', default='200,40', help='azimut,elevación del sol (grados)')
ap.add_argument('--camara', type=float, default=-25, help='lado desde el que mira la cámara: ángulo en el plano (0 = oeste, 90 = sur), ya con el giro de 25°')
a = ap.parse_args()
L = json.load(open(a.layout)); CORTE = a.corte; M = 0.01  # cm → m
EXT = 0.18  # grosor de los muros exteriores (m)

rooms = {k: Polygon(np.array(h['poligono']) * M) for k, h in L['habitaciones'].items()}
todo = unary_union(list(rooms.values()))
huella = unary_union([p.buffer(EXT, join_style=2, mitre_limit=5) for p in rooms.values()])
muros2d = huella.difference(todo)

def seg(o):
    xs = o['x'] if isinstance(o['x'], list) else [o['x']] * 2
    ys = o['y'] if isinstance(o['y'], list) else [o['y']] * 2
    return LineString([(xs[0] * M, ys[0] * M), (xs[1] * M, ys[1] * M)])
huecos = []  # (forma 2D, desde, hasta)
for o in L['aberturas']:
    huecos.append((seg(o).buffer(0.40, cap_style=2), 0.0, o.get('alto', 210) * M))
for o in L['ventanas']:
    huecos.append((seg(o).buffer(0.40, cap_style=2), o.get('desde', 90) * M, o.get('hasta', 210) * M))

# ---------- utilidades de Blender ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def material(nombre, color, rough=0.6, alpha=1.0, transmision=0.0):
    m = bpy.data.materials.new(nombre); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    if transmision: b.inputs['Transmission Weight'].default_value = transmision; b.inputs['IOR'].default_value = 1.45
    if alpha < 1: b.inputs['Alpha'].default_value = alpha
    return m
MAT = dict(
    muro=material('muro', (0.78, 0.77, 0.74), 0.8),
    corte=material('corte', (0.25, 0.24, 0.23), 0.9),
    madera=material('madera', (0.62, 0.43, 0.25), 0.45),
    baldosa=material('baldosa', (0.80, 0.80, 0.78), 0.3),
    base=material('base', (0.30, 0.30, 0.30), 0.9),
    suelo_ext=material('suelo_ext', (0.22, 0.24, 0.22), 0.95),
    mueble=material('mueble', (0.93, 0.92, 0.90), 0.6),
    mueble_madera=material('mueble_madera', (0.45, 0.30, 0.18), 0.5),
    sofa=material('sofa', (0.30, 0.31, 0.33), 0.9),
    cristal=material('cristal', (0.85, 0.93, 1.0), 0.05, transmision=1.0),
)
def malla(nombre, tm, mat):
    me = bpy.data.meshes.new(nombre)
    me.from_pydata([tuple(v) for v in tm.vertices], [], [tuple(f) for f in tm.faces]); me.update()
    ob = bpy.data.objects.new(nombre, me); sc.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob
def extruir(geom, z0, z1, nombre, mat):
    if geom.is_empty or z1 - z0 < 1e-4: return
    polys = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    tms = []
    for p in polys:
        if p.area < 1e-4: continue
        t = trimesh.creation.extrude_polygon(p, z1 - z0); t.apply_translation((0, 0, z0)); tms.append(t)
    if tms: malla(nombre, trimesh.util.concatenate(tms), mat)

# ---------- muros por franjas de altura ----------
cortes = sorted({0.0, CORTE} | {z for _, d, h in huecos for z in (d, h) if 0 < z < CORTE})
for i, (z0, z1) in enumerate(zip(cortes[:-1], cortes[1:])):
    quitar = unary_union([g for g, d, h in huecos if d <= z0 + 1e-6 and h >= z1 - 1e-6] or [Polygon()])
    extruir(muros2d.difference(quitar), z0, z1, f'muro_{i}', MAT['muro'])
# tapa oscura del corte (como en una maqueta)
quitar = unary_union([g for g, d, h in huecos if h >= CORTE] or [Polygon()])
extruir(muros2d.difference(quitar), CORTE, CORTE + 0.01, 'corte', MAT['corte'])

# ---------- suelos ----------
humedas = {'bano_1', 'bano_2', 'cocina', 'tendedero'}
for k, p in rooms.items():
    extruir(p, -0.02, 0.0, f'suelo_{k}', MAT['baldosa'] if k in humedas else MAT['madera'])
extruir(huella.buffer(0.02), -0.12, -0.02, 'forjado', MAT['base'])
extruir(box(-6, -6, 16, 20), -0.13, -0.12, 'exterior', MAT['suelo_ext'])

# ---------- cristales ----------
for i, o in enumerate(L['ventanas']):
    s = seg(o); h = min(o.get('hasta', 210) * M, CORTE); d = o.get('desde', 90) * M
    if h > d: extruir(s.buffer(0.012, cap_style=2), d, h, f'cristal_{i}', MAT['cristal'])

# ---------- muebles ----------
for i, mb in enumerate(L.get('muebles', [])):
    (x0, y0), (x1, y1) = mb['caja']; alto = min(mb.get('alto', 80) * M, CORTE - 0.02)
    n = mb['nombre'].lower()
    mat = MAT['sofa'] if 'sofá' in n else MAT['mueble_madera'] if ('madera' in n or 'mesa' in n) else MAT['mueble']
    caja = box(x0 * M, y0 * M, x1 * M, y1 * M).difference(muros2d.buffer(0.01)).buffer(-0.005)
    extruir(caja, 0, alto, f'mueble_{i}', mat)

# ---------- sol (azimut real) y cielo ----------
azY = L.get('orientacion', {}).get('azimut_eje_+Y', 180.0)
s_az, s_el = map(float, a.sol.split(','))
ang = math.radians(s_az - azY)  # ángulo en el plano, horario desde +Y
hacia_sol = Vector((math.sin(ang) * math.cos(math.radians(s_el)), math.cos(ang) * math.cos(math.radians(s_el)), math.sin(math.radians(s_el))))
sun = bpy.data.lights.new('sol', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new('sol', sun); sc.collection.objects.link(so)
so.rotation_euler = hacia_sol.to_track_quat('Z', 'Y').to_euler()
w = bpy.data.worlds.new('cielo'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.95, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45

# ---------- cámara de diorama: 30° desde la vertical, girada 25° ----------
minx, miny, maxx, maxy = huella.bounds
c = Vector(((minx + maxx) / 2, (miny + maxy) / 2, 0.3))
t, r = math.radians(30), math.radians(a.camara)
hdir = Vector((math.cos(r), math.sin(r), 0))  # -25 = desde el oeste; 65 = desde el sur (ventanal abajo)
cam = bpy.data.cameras.new('cam'); cam.lens = 85; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
D = 42.0
co.location = c + D * (math.sin(t) * hdir + Vector((0, 0, math.cos(t))))
co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = co
# encuadre automático: ajusta la distancia para que quepa todo con margen
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
rx, ry = map(int, a.res.split('x')); sc.render.resolution_x, sc.render.resolution_y = rx, ry
pts = [Vector((x, y, z)) for x, y in huella.exterior.coords for z in (0, CORTE)]
for _ in range(6):
    bpy.context.view_layer.update()
    uv = [world_to_camera_view(sc, co, p) for p in pts]
    span = max(max(u.x for u in uv) - min(u.x for u in uv), max(u.y for u in uv) - min(u.y for u in uv))
    co.location = c + (co.location - c) * (span / 0.92)
    mid = Vector((sum(u.x for u in uv) / len(uv) - 0.5, sum(u.y for u in uv) / len(uv) - 0.5))
    cam.shift_x, cam.shift_y = mid.x, mid.y * ry / rx

# ---------- render ----------
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = a.muestras
sc.cycles.use_denoising = True; sc.render.film_transparent = False
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.filepath = a.salida; sc.render.image_settings.file_format = 'PNG'
if a.blend: bpy.ops.wm.save_as_mainfile(filepath=a.blend)
bpy.ops.render.render(write_still=True)
print('render ->', a.salida)
