"""Construye la casa en Blender a partir de layout.json y hace un render.

Uso (Blender como módulo de Python, sin abrir Blender):
  python casa/modelo.py casa/layout.json salida.png [--blend casa.blend] [--muestras 48]

Muros = (habitaciones engordadas) − (habitaciones), cortados a CORTE m de altura,
con los huecos de puertas y ventanas recortados por franjas de altura. Cada
habitación lleva un revestimiento fino con el acabado de sus paredes y su suelo.
"""
import json, math, argparse, warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
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
ap.add_argument('--camara', type=float, default=None,
                help='lado de la cámara: ángulo en el plano (0 = oeste, 90 = sur); por defecto el de layout.json')
a = ap.parse_args()
L = json.load(open(a.layout)); CORTE = a.corte; M = 0.01  # cm → m
EXT = 0.18  # grosor de los muros exteriores (m)
PIEL = 0.012  # grosor del revestimiento interior (m)

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
cortes = sorted({0.0, CORTE} | {z for _, d, h in huecos for z in (d, h) if 0 < z < CORTE})
def franjas():
    """(z0, z1, huecos que atraviesan toda la franja)"""
    for z0, z1 in zip(cortes[:-1], cortes[1:]):
        yield z0, z1, unary_union([g for g, d, h in huecos if d <= z0 + 1e-6 and h >= z1 - 1e-6] or [Polygon()])

# ---------- materiales ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x ** 2.2 for x in c)  # sRGB → lineal
_mats = {}
def material(nombre, color, rough=0.6, transmision=0.0):
    if nombre in _mats: return _mats[nombre]
    m = bpy.data.materials.new(nombre); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*(hexrgb(color) if isinstance(color, str) else color), 1)
    b.inputs['Roughness'].default_value = rough
    if transmision: b.inputs['Transmission Weight'].default_value = transmision; b.inputs['IOR'].default_value = 1.45
    _mats[nombre] = m; return m
def material_ladrillo(nombre, c1, c2, junta, ancho, alto, rough=0.5, junta_mm=2):
    """Suelo con patrón de piezas (parquet, barro, baldosa) en coordenadas del mundo."""
    m = bpy.data.materials.new(nombre); m.use_nodes = True; nt = m.node_tree; N = nt.nodes
    b = N['Principled BSDF']; b.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord'); br = N.new('ShaderNodeTexBrick')
    br.inputs['Color1'].default_value = (*hexrgb(c1), 1); br.inputs['Color2'].default_value = (*hexrgb(c2), 1)
    br.inputs['Mortar'].default_value = (*hexrgb(junta), 1); br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = junta_mm / 1000; br.inputs['Brick Width'].default_value = ancho
    br.inputs['Row Height'].default_value = alto; br.offset = 0.5
    nt.links.new(tc.outputs['Object'], br.inputs['Vector']); nt.links.new(br.outputs['Color'], b.inputs['Base Color'])
    return m
SUELOS = dict(
    parquet=material_ladrillo('parquet', '#a67a50', '#906640', '#5e4128', 0.24, 0.07, 0.35, 1),
    barro=material_ladrillo('barro', '#b8683c', '#a95d35', '#d9c3a5', 0.20, 0.20, 0.55, 4),
    baldosa_beige=material_ladrillo('baldosa_beige', '#e2d7c4', '#d9ccb6', '#efe8dc', 0.33, 0.33, 0.25, 3),
)
PAREDES = dict(
    crema=material('p_crema', '#e9e3d7', 0.85), azulejo_beige=material('p_azulejo_beige', '#d8c7ab', 0.3),
    azulejo_cocina=material('p_azulejo_cocina', '#e4d6bd', 0.3), madera_oscura=material('p_madera_oscura', '#5a2e1c', 0.45),
)
MAT = dict(
    muro=material('muro', '#e2ddd3', 0.8), corte=material('corte', '#3a3835', 0.9),
    base=material('base', '#4a4a4a', 0.9), suelo_ext=material('suelo_ext', '#3a3d3a', 0.95),
    cristal=material('cristal', (0.85, 0.93, 1.0), 0.05, transmision=1.0),
    patas=material('patas', '#e8e8e8', 0.4), planta=material('planta', '#4f6f34', 0.7),
    maceta=material('maceta', '#b36a3e', 0.7), metal=material('metal', '#9a9a9a', 0.35),
)

# ---------- geometría ----------
def malla(nombre, tm, mat):
    me = bpy.data.meshes.new(nombre)
    me.from_pydata([tuple(v) for v in tm.vertices], [], [tuple(f) for f in tm.faces]); me.update()
    ob = bpy.data.objects.new(nombre, me); sc.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob
def extruir(geom, z0, z1, nombre, mat):
    if geom is None or geom.is_empty or z1 - z0 < 1e-4: return
    polys = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    tms = []
    for p in polys:
        if p.area < 1e-5: continue
        t = trimesh.creation.extrude_polygon(p, z1 - z0); t.apply_translation((0, 0, z0)); tms.append(t)
    if tms: return malla(nombre, trimesh.util.concatenate(tms), mat)

# muros por franjas de altura + tapa oscura del corte (como en una maqueta)
for i, (z0, z1, quitar) in enumerate(franjas()):
    extruir(muros2d.difference(quitar), z0, z1, f'muro_{i}', MAT['muro'])
quitar = unary_union([g for g, d, h in huecos if h >= CORTE] or [Polygon()])
extruir(muros2d.buffer(PIEL).difference(todo.buffer(-PIEL)).difference(quitar), CORTE, CORTE + 0.012, 'corte', MAT['corte'])

# suelos y revestimientos de cada habitación
for k, p in rooms.items():
    h = L['habitaciones'][k]
    extruir(p, -0.02, 0.0, f'suelo_{k}', SUELOS.get(h.get('suelo', 'parquet'), SUELOS['parquet']))
    piel = p.difference(p.buffer(-PIEL, join_style=2))
    zonas = h.get('zonas', [])
    for i, (z0, z1, quitar) in enumerate(franjas()):
        resto = piel.difference(quitar)
        for zn in zonas:  # zonas con otro acabado (p. ej. la antigua terraza)
            caja = box(-50, zn['y_desde'] * M, 50, 50)
            extruir(resto.intersection(caja), z0, z1, f'piel_{k}_{zn["nombre"]}_{i}', PAREDES[zn['paredes']])
            resto = resto.difference(caja)
        extruir(resto, z0, z1, f'piel_{k}_{i}', PAREDES.get(h.get('paredes', 'crema'), PAREDES['crema']))
extruir(huella.buffer(0.02), -0.12, -0.02, 'forjado', MAT['base'])
extruir(box(-8, -8, 18, 22), -0.13, -0.12, 'exterior', MAT['suelo_ext'])

# cristales
for i, o in enumerate(L['ventanas']):
    s = seg(o); h = min(o.get('hasta', 210) * M, CORTE); d = o.get('desde', 90) * M
    if h > d: extruir(s.buffer(0.012, cap_style=2), d, h, f'cristal_{i}', MAT['cristal'])

# ---------- muebles ----------
def lado(b, cual, fondo):
    """Franja de 'fondo' m pegada al lado indicado de la caja (x-, x+, y-, y+)."""
    x0, y0, x1, y1 = b.bounds
    return {'x-': box(x0, y0, x0 + fondo, y1), 'x+': box(x1 - fondo, y0, x1, y1),
            'y-': box(x0, y0, x1, y0 + fondo), 'y+': box(x0, y1 - fondo, x1, y1)}[cual]
def mueble(i, mb):
    (x0, y0), (x1, y1) = mb['caja']; b = box(x0 * M, y0 * M, x1 * M, y1 * M)
    b = b.difference(muros2d.buffer(0.005)).buffer(-0.004, join_style=2)
    if b.is_empty: return
    t = mb.get('tipo', 'caja'); alto = min(mb.get('alto', 80) * M, CORTE - 0.02)
    col = material('m_' + mb.get('color', '#eeeeee'), mb.get('color', '#eeeeee'), 0.55)
    col2 = material('m_' + mb.get('color2', mb.get('color', '#eeeeee')), mb.get('color2', mb.get('color', '#eeeeee')), 0.5)
    n = f'mueble_{i}'
    if t == 'caja':
        extruir(b, 0, alto, n, col)
    elif t == 'alfombra':
        extruir(b, 0, 0.012, n, col)
    elif t == 'pantalla':
        extruir(b, mb.get('desde', 50) * M, alto, n, col)
    elif t == 'cama':  # somier + colchón + cabecero
        cab = mb.get('cabecero', 'x-'); resto = b.difference(lado(b, cab, 0.08))
        extruir(resto, 0, alto * 0.55, n + '_base', col2)
        extruir(resto.buffer(-0.01, join_style=2), alto * 0.55, alto, n + '_colchon', col)
        extruir(lado(b, cab, 0.08), 0, min(alto + 0.55, CORTE - 0.02), n + '_cabecero', col2)
    elif t == 'sofa':  # asiento + respaldo + brazos
        r = mb.get('respaldo', 'x+'); x0b, y0b, x1b, y1b = b.bounds
        brazos = ('y-', 'y+') if r[0] == 'x' else ('x-', 'x+')
        asiento = b.difference(lado(b, r, 0.2))
        for br in brazos: asiento = asiento.difference(lado(b, br, 0.14))
        extruir(asiento, 0.1, alto * 0.5, n + '_asiento', col)
        extruir(lado(b, r, 0.2), 0.1, alto, n + '_respaldo', col)
        for j, br in enumerate(brazos): extruir(lado(b, br, 0.14), 0.1, alto * 0.72, n + f'_brazo{j}', col)
        extruir(b.buffer(-0.03, join_style=2), 0, 0.1, n + '_patas', material('patas_madera', '#8a6a48', 0.5))
    elif t == 'mesa':  # tablero + 4 patas
        extruir(b, alto - 0.03, alto, n + '_tablero', col)
        x0b, y0b, x1b, y1b = b.bounds
        for j, (px, py) in enumerate([(x0b, y0b), (x1b - .04, y0b), (x0b, y1b - .04), (x1b - .04, y1b - .04)]):
            extruir(box(px, py, px + .04, py + .04), 0, alto - 0.03, n + f'_pata{j}', col)
    elif t == 'silla':
        r = mb.get('respaldo', 'y-')
        extruir(b, alto - 0.04, alto, n + '_asiento', col)
        extruir(lado(b, r, 0.04), alto, alto + 0.4, n + '_respaldo', col)
        extruir(b.buffer(-0.12, join_style=2) if b.area > 0.03 else b, 0, alto - 0.04, n + '_pie', MAT['metal'])
    elif t == 'armario':  # cuerpo + frente de otro color
        f = mb.get('frente', 'y+')
        extruir(b.difference(lado(b, f, 0.02)), 0, alto, n, col)
        extruir(lado(b, f, 0.02), 0.05, alto, n + '_frente', col2)
    elif t == 'encimera':  # módulos + encimera
        extruir(b.buffer(-0.03, join_style=2), 0, alto - 0.04, n, col)
        extruir(b, alto - 0.04, alto, n + '_encimera', material('encimera', '#fafafa', 0.25))
    elif t == 'banera':
        extruir(b.difference(b.buffer(-0.07, join_style=2)), 0, alto, n, col)
        extruir(b.buffer(-0.07, join_style=2), 0, 0.18, n + '_fondo', col)
    elif t == 'inodoro':
        extruir(b.centroid.buffer(min(b.bounds[2] - b.bounds[0], b.bounds[3] - b.bounds[1]) / 2 * 0.95), 0, alto, n, col)
    elif t == 'planta':
        extruir(b.centroid.buffer((b.bounds[2] - b.bounds[0]) / 2 * 0.7), 0, alto * 0.35, n + '_maceta', MAT['maceta'])
        extruir(b.centroid.buffer((b.bounds[2] - b.bounds[0]) / 2), alto * 0.35, alto, n + '_hojas', MAT['planta'])
    elif t == 'tendedero':
        extruir(b.difference(b.buffer(-0.02, join_style=2)), alto - 0.02, alto, n, MAT['metal'])
        for j in range(1, 6):
            x0b, y0b, x1b, y1b = b.bounds; xx = x0b + (x1b - x0b) * j / 6
            extruir(box(xx - 0.004, y0b, xx + 0.004, y1b), alto - 0.02, alto, n + f'_v{j}', MAT['metal'])
    else:
        extruir(b, 0, alto, n, col)
for i, mb in enumerate(L.get('muebles', [])):
    mueble(i, mb)

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
t = math.radians(L.get('camara', {}).get('inclinacion_desde_vertical', 30))
r = math.radians(a.camara if a.camara is not None else L.get('camara', {}).get('lado', -25))
hdir = Vector((math.cos(r), math.sin(r), 0))  # -25 = desde el oeste; 65 = desde el sur (ventanal abajo)
cam = bpy.data.cameras.new('cam'); cam.lens = 85; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
co.location = c + 42.0 * (math.sin(t) * hdir + Vector((0, 0, math.cos(t))))
co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = co
from bpy_extras.object_utils import world_to_camera_view
rx, ry = map(int, a.res.split('x')); sc.render.resolution_x, sc.render.resolution_y = rx, ry
pts = [Vector((x, y, z)) for x, y in huella.exterior.coords for z in (0, CORTE)]
for _ in range(6):  # encuadre automático
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
