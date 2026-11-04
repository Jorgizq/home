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
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union

ap = argparse.ArgumentParser()
ap.add_argument('layout'); ap.add_argument('salida')
ap.add_argument('--blend'); ap.add_argument('--muestras', type=int, default=48)
ap.add_argument('--corte', type=float, default=1.40)
ap.add_argument('--res', default='1600x1200')
ap.add_argument('--sol', default='200,40', help='azimut,elevación del sol (grados)')
ap.add_argument('--inclinacion', type=float, default=None, help='grados desde la vertical (0 = planta); por defecto el de layout.json')
ap.add_argument('--sin-render', action='store_true', help='solo guarda el .blend')
ap.add_argument('--noche', action='store_true', help='sin sol: solo luna y las luces elegidas')
ap.add_argument('--luces', default='ninguna', help="'todas', 'ninguna' o lista separada por comas de números o entidades de luces.json")
ap.add_argument('--techo', action='store_true', help='techo y muros completos invisibles a la cámara (siempre en --noche)')
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

# ---------- acabados de muebles (procedurales: sin texturas externas) ----------
import colorsys
def _rgb(h): h = h.lstrip('#'); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
def tipo_acabado(color):
    """Adivina el acabado por el color: madera (marrones), lacado (blancos y grises claros), o tela."""
    hh, s, v = colorsys.rgb_to_hsv(*_rgb(color))
    if 15 / 360 <= hh <= 50 / 360 and s > 0.25 and v > 0.18: return 'madera'
    if s < 0.12 and v > 0.78: return 'lacado'
    return 'tela'
def acabado(tipo, color):
    nombre = f'{tipo}_{color}'
    if nombre in _mats: return _mats[nombre]
    m = bpy.data.materials.new(nombre); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; Lk = nt.links.new
    b = N['Principled BSDF']; c1 = hexrgb(color)
    b.inputs['Base Color'].default_value = (*c1, 1)
    tc = N.new('ShaderNodeTexCoord')
    if tipo == 'madera':  # veta: ondas deformadas con ruido, entre el color y una versión más oscura
        mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.6, 14.0, 14.0)
        wv = N.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 1.2
        wv.inputs['Distortion'].default_value = 2.5; wv.inputs['Detail'].default_value = 2.0
        wv.inputs['Detail Scale'].default_value = 0.6
        cr = N.new('ShaderNodeValToRGB')
        cr.color_ramp.elements[0].color = (*[x * 0.86 for x in c1], 1); cr.color_ramp.elements[1].color = (*c1, 1)
        Lk(tc.outputs['Object'], mp.inputs['Vector']); Lk(mp.outputs['Vector'], wv.inputs['Vector'])
        Lk(wv.outputs['Fac'], cr.inputs['Fac']); Lk(cr.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.42
    elif tipo in ('tela', 'alfombra'):  # trama fina en relieve y un poco de brillo de tela
        nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900 if tipo == 'tela' else 300
        bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.12 if tipo == 'tela' else 0.45
        Lk(tc.outputs['Object'], nz.inputs['Vector']); Lk(nz.outputs['Fac'], bp.inputs['Height'])
        Lk(bp.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = 0.92; b.inputs['Sheen Weight'].default_value = 0.6
    elif tipo == 'lacado':
        b.inputs['Roughness'].default_value = 0.28; b.inputs['Coat Weight'].default_value = 0.25
    elif tipo == 'ceramica':
        b.inputs['Roughness'].default_value = 0.06; b.inputs['Coat Weight'].default_value = 0.6
    elif tipo == 'esmerilado':
        b.inputs['Roughness'].default_value = 0.45; b.inputs['Transmission Weight'].default_value = 0.85
    elif tipo == 'metal':
        b.inputs['Metallic'].default_value = 1.0; b.inputs['Roughness'].default_value = 0.35
    elif tipo == 'planta':  # hojas con variación de verde
        nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 12
        cr = N.new('ShaderNodeValToRGB')
        cr.color_ramp.elements[0].color = (*[x * 0.6 for x in c1], 1); cr.color_ramp.elements[1].color = (*[min(1, x * 1.3) for x in c1], 1)
        Lk(tc.outputs['Object'], nz.inputs['Vector']); Lk(nz.outputs['Fac'], cr.inputs['Fac']); Lk(cr.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.6; b.inputs['Subsurface Weight'].default_value = 0.1
    _mats[nombre] = m; return m

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
import bmesh, random
def lado(b, cual, fondo):
    """Franja de 'fondo' m pegada al lado indicado de la caja (x-, x+, y-, y+)."""
    x0, y0, x1, y1 = b.bounds
    return {'x-': box(x0, y0, x0 + fondo, y1), 'x+': box(x1 - fondo, y0, x1, y1),
            'y-': box(x0, y0, x1, y0 + fondo), 'y+': box(x0, y1 - fondo, x1, y1)}[cual]
def trozos(b, eje, n, hueco=0.01):
    """Parte la caja en n trozos iguales a lo largo de 'x' o 'y', con una junta entre ellos."""
    x0, y0, x1, y1 = b.bounds; out = []
    for k in range(n):
        if eje == 'x': a0 = x0 + (x1 - x0) * k / n; a1 = x0 + (x1 - x0) * (k + 1) / n; q = box(a0 + hueco / 2, y0, a1 - hueco / 2, y1)
        else: a0 = y0 + (y1 - y0) * k / n; a1 = y0 + (y1 - y0) * (k + 1) / n; q = box(x0, a0 + hueco / 2, x1, a1 - hueco / 2)
        out.append(q.intersection(b))
    return out
def suavizar(ob, ancho=0.012):
    """Cantos redondeados (bisel) y sombreado suave: quita el aspecto de caja de cartón."""
    if ob is None: return ob
    me = ob.data; me.shade_smooth()
    try: me.set_sharp_from_angle(angle=math.radians(35))
    except AttributeError: pass
    md = ob.modifiers.new('bisel', 'BEVEL'); md.width = ancho; md.segments = 2
    md.limit_method = 'ANGLE'; md.angle_limit = math.radians(35); md.use_clamp_overlap = True
    md.harden_normals = False
    return ob
def pieza(geom, z0, z1, nombre, mat, bisel=0.012):
    return suavizar(extruir(geom, z0, z1, nombre, mat), min(bisel, (z1 - z0) / 3))
def esferas(nombre, centro, radio, alto0, alto1, n, mat, semilla=0):
    """Mata de hojas: varias esferas irregulares (plantas)."""
    rnd = random.Random(semilla); bm = bmesh.new()
    for k in range(n):
        r = radio * rnd.uniform(0.45, 0.8); cx = centro[0] + rnd.uniform(-1, 1) * radio * 0.5
        cy = centro[1] + rnd.uniform(-1, 1) * radio * 0.5; cz = rnd.uniform(alto0 + r * 0.6, max(alto0 + r * 0.7, alto1 - r))
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in res['verts']: v.co.x += cx; v.co.y += cy; v.co.z += cz
    me = bpy.data.meshes.new(nombre); bm.to_mesh(me); bm.free(); me.shade_smooth()
    ob = bpy.data.objects.new(nombre, me); sc.collection.objects.link(ob); ob.data.materials.append(mat); return ob
def mat_de(mb, clave='color', defecto='#eeeeee', acab=None):
    c = mb.get(clave, mb.get('color', defecto))
    return acabado(acab or mb.get('acabado' if clave == 'color' else 'acabado2') or tipo_acabado(c), c)
def eje_largo(b):
    x0, y0, x1, y1 = b.bounds; return 'x' if x1 - x0 >= y1 - y0 else 'y'
MADERA_PATAS = acabado('madera', '#8a6a48')
def mueble(i, mb):
    (x0, y0), (x1, y1) = mb['caja']; b = box(x0 * M, y0 * M, x1 * M, y1 * M)
    b = b.difference(muros2d.buffer(0.005)).buffer(-0.004, join_style=2)
    if b.is_empty: return
    t = mb.get('tipo', 'caja'); alto = min(mb.get('alto', 80) * M, CORTE - 0.02)
    col = mat_de(mb); col2 = mat_de(mb, 'color2'); n = f'mueble_{i}'
    if t == 'caja':
        f = mb.get('frente'); nc = mb.get('cajones', 0)
        if f and nc:  # cuerpo + frentes de cajón con junta
            pieza(b.difference(lado(b, f, 0.02)), 0, alto, n, col)
            for k in range(nc):
                za = 0.03 + (alto - 0.03) * k / nc; zb = 0.03 + (alto - 0.03) * (k + 1) / nc
                pieza(lado(b, f, 0.02), za + 0.003, zb - 0.003, n + f'_cajon{k}', col2, 0.004)
        else:
            pieza(b, 0, alto, n, col)
    elif t == 'alfombra':
        pieza(b, 0, 0.015, n, acabado('alfombra', mb.get('color', '#cccccc')), 0.006)
    elif t in ('pantalla', 'flotante'):  # pieza que no toca el suelo (tele, tabla, microondas...)
        pieza(b, mb.get('desde', 50) * M, alto, n, col, 0.005)
    elif t == 'cama':
        cab = mb.get('cabecero', 'x-'); resto = b.difference(lado(b, cab, 0.08))
        tela_blanca = acabado('tela', mb.get('color', '#f4f2ee'))
        if mb.get('barandilla'):  # cama Montessori: marco de madera con barandilla y hueco para subir
            madera = acabado('madera', mb.get('color2', '#d9bf98'))
            pieza(b, 0, 0.08, n + '_marco', madera, 0.01)
            pieza(b.buffer(-0.04, join_style=2), 0.08, alto, n + '_colchon', tela_blanca, 0.03)
            aro = b.difference(b.buffer(-0.035, join_style=2))
            x0b, y0b, x1b, y1b = b.bounds; lar = max(x1b - x0b, y1b - y0b)
            hueco = b.centroid.buffer(lar * 0.22, cap_style=3).intersection(lado(b, 'x+', 0.05))
            pieza(aro.difference(hueco), 0.08, alto + 0.2, n + '_barandilla', madera, 0.008)
        else:  # canapé tapizado + colchón + nórdico + almohadas + cabecero tapizado
            tapiz = acabado('tela', mb.get('color2', '#b9b2a8'))
            pieza(resto, 0, alto * 0.5, n + '_base', tapiz, 0.02)
            pieza(resto.buffer(-0.01, join_style=2), alto * 0.5, alto, n + '_colchon', tela_blanca, 0.04)
            pies = {'x-': 'x+', 'x+': 'x-', 'y-': 'y+', 'y+': 'y-'}[cab]
            x0b, y0b, x1b, y1b = resto.bounds; largo = (x1b - x0b) if cab[0] == 'x' else (y1b - y0b)
            pieza(lado(resto, pies, largo * 0.72).buffer(0.025, join_style=2), alto - 0.01, alto + 0.05, n + '_nordico',
                  acabado('tela', '#f7f5f1'), 0.025)
            almo = lado(resto, cab, 0.4).buffer(-0.05, join_style=2)
            ancho = (y1b - y0b) if cab[0] == 'x' else (x1b - x0b)
            for k, q in enumerate(trozos(almo, 'y' if cab[0] == 'x' else 'x', 2 if ancho > 1.2 else 1, 0.06)):
                pieza(q, alto, alto + 0.13, n + f'_almohada{k}', tela_blanca, 0.05)
            pieza(lado(b, cab, 0.08), 0, min(alto + 0.6, CORTE - 0.02), n + '_cabecero', tapiz, 0.03)
    elif t == 'sofa':  # patas + base + cojines de asiento + respaldo con cojines + brazos
        r = mb.get('respaldo', 'x+'); tela = acabado('tela', mb.get('color', '#777777'))
        brazos = ('y-', 'y+') if r[0] == 'x' else ('x-', 'x+')
        x0b, y0b, x1b, y1b = b.bounds; prof = (x1b - x0b) if r[0] == 'x' else (y1b - y0b)
        brazo = 0.14 if prof > 0.6 else 0.08
        interior = b
        for br in brazos: interior = interior.difference(lado(b, br, brazo))
        respaldo = lado(b, r, 0.18).intersection(b)
        asiento = interior.difference(lado(b, r, 0.18))
        largo = (y1b - y0b) if r[0] == 'x' else (x1b - x0b); nc = max(1, round((largo - 2 * brazo) / 0.7))
        ejeL = 'y' if r[0] == 'x' else 'x'
        for k, q in enumerate([b.buffer(-0.04, join_style=2)]):
            x0q, y0q, x1q, y1q = q.bounds
            for j, (px, py) in enumerate([(x0q, y0q), (x1q - .04, y0q), (x0q, y1q - .04), (x1q - .04, y1q - .04)]):
                extruir(box(px, py, px + .04, py + .04), 0, 0.09, n + f'_pata{j}', MADERA_PATAS)
        pieza(b, 0.09, 0.28, n + '_base', tela, 0.02)
        for k, q in enumerate(trozos(asiento, ejeL, nc, 0.012)):
            pieza(q, 0.28, alto * 0.53, n + f'_cojin{k}', tela, 0.04)
        pieza(respaldo, 0.28, alto, n + '_respaldo', tela, 0.04)
        delante = lado(b, r, 0.32).intersection(interior).difference(respaldo)
        for k, q in enumerate(trozos(delante, ejeL, nc, 0.012)):
            pieza(q, alto * 0.53, alto * 0.95, n + f'_cojin_resp{k}', tela, 0.05)
        for j, br in enumerate(brazos): pieza(lado(b, br, brazo), 0.28, alto * 0.72, n + f'_brazo{j}', tela, 0.04)
    elif t == 'mesa':  # tablero + 4 patas (color2 = patas)
        pieza(b, alto - 0.03, alto, n + '_tablero', col, 0.008)
        x0b, y0b, x1b, y1b = b.bounds; e = 0.045
        for j, (px, py) in enumerate([(x0b + .02, y0b + .02), (x1b - .02 - e, y0b + .02), (x0b + .02, y1b - .02 - e), (x1b - .02 - e, y1b - .02 - e)]):
            pieza(box(px, py, px + e, py + e), 0, alto - 0.03, n + f'_pata{j}', col2, 0.008)
    elif t == 'silla':  # carcasa (asiento + respaldo) con patas de madera
        r = mb.get('respaldo', 'y-'); carcasa = acabado('lacado', mb.get('color', '#dcd9d3'))
        pieza(b, alto - 0.03, alto + 0.01, n + '_asiento', carcasa, 0.012)
        pieza(lado(b, r, 0.035), alto, alto + 0.38, n + '_respaldo', carcasa, 0.012)
        x0b, y0b, x1b, y1b = b.bounds; e = 0.025
        for j, (px, py) in enumerate([(x0b + .04, y0b + .04), (x1b - .04 - e, y0b + .04), (x0b + .04, y1b - .04 - e), (x1b - .04 - e, y1b - .04 - e)]):
            extruir(box(px, py, px + e, py + e), 0, alto - 0.03, n + f'_pata{j}',
                    MADERA_PATAS if mb.get('patas', 'madera') == 'madera' else acabado('metal', '#2a2a2a'))
    elif t == 'armario':  # cuerpo + puertas con junta; 'bandas' = franjas del frente por altura (PAX)
        f = mb.get('frente', 'y+')
        pieza(b.difference(lado(b, f, 0.02)), 0, alto, n, col, 0.006)
        frente = lado(b, f, 0.02); ejeF = 'x' if f[0] == 'y' else 'y'
        x0b, y0b, x1b, y1b = b.bounds; largo = (x1b - x0b) if ejeF == 'x' else (y1b - y0b)
        npuertas = mb.get('puertas') or max(1, round(largo / 0.5))
        bandas = mb.get('bandas') or [dict(desde=0, hasta=999, color=mb.get('color2', mb.get('color')))]
        for k, q in enumerate(trozos(frente, ejeF, npuertas, 0.006)):
            for j, bd in enumerate(bandas):
                za = max(0.05, bd['desde'] * M) + 0.002; zb = min(alto, bd['hasta'] * M) - 0.002
                if zb > za:
                    pieza(q, za, zb, n + f'_puerta{k}_{j}', acabado(bd.get('acabado') or tipo_acabado(bd['color']), bd['color']), 0.004)
    elif t == 'encimera':  # módulos con puertas + zócalo + encimera
        f = mb.get('frente'); blanco = acabado('lacado', mb.get('color', '#f4f4f2'))
        pieza(b.buffer(-0.05, join_style=2), 0, 0.1, n + '_zocalo', acabado('lacado', '#b9b9b9'), 0.003)
        cuerpo = b.buffer(-0.02, join_style=2)
        if f:
            pieza(cuerpo.difference(lado(cuerpo, f, 0.02)), 0.1, alto - 0.04, n, blanco, 0.004)
            ejeF = 'x' if f[0] == 'y' else 'y'; x0b, y0b, x1b, y1b = b.bounds
            largo = (x1b - x0b) if ejeF == 'x' else (y1b - y0b)
            for k, q in enumerate(trozos(lado(cuerpo, f, 0.02), ejeF, max(1, round(largo / 0.6)), 0.005)):
                pieza(q, 0.1, alto - 0.045, n + f'_puerta{k}', blanco, 0.004)
        else:
            pieza(cuerpo, 0.1, alto - 0.04, n, blanco, 0.004)
        pieza(b, alto - 0.04, alto, n + '_encimera', acabado('lacado', '#fafafa'), 0.004)
    elif t == 'banera':
        cer = acabado('ceramica', mb.get('color', '#f7f7f5'))
        pieza(b.difference(b.buffer(-0.07, join_style=2)), 0, alto, n, cer, 0.02)
        pieza(b.buffer(-0.07, join_style=2), 0, 0.18, n + '_fondo', cer, 0.02)
    elif t in ('vater', 'bide', 'lavabo'):  # sanitarios con forma: 'pared' = lado de la caja pegado a la pared
        cer = acabado('ceramica', mb.get('color', '#f7f7f5')); pared = mb.get('pared', 'y+')
        x0b, y0b, x1b, y1b = b.bounds; cx, cy = b.centroid.x, b.centroid.y
        hacia = {'x-': (1, 0), 'x+': (-1, 0), 'y-': (0, 1), 'y+': (0, -1)}[pared]  # de la pared hacia fuera
        ancho = (y1b - y0b) if pared[0] == 'x' else (x1b - x0b); fondo = (x1b - x0b) if pared[0] == 'x' else (y1b - y0b)
        borde = {'x-': x0b, 'x+': x1b, 'y-': y0b, 'y+': y1b}[pared]
        def ovalo(dist, semi_fondo, semi_ancho):  # óvalo con el eje largo saliendo de la pared
            from shapely import affinity
            px = borde + hacia[0] * dist if pared[0] == 'x' else cx
            py = borde + hacia[1] * dist if pared[0] == 'y' else cy
            sxx, syy = (semi_fondo, semi_ancho) if pared[0] == 'x' else (semi_ancho, semi_fondo)
            return affinity.scale(Point(px, py).buffer(1, 32), sxx, syy)
        if t == 'lavabo':  # columna + lavabo ovalado a 85 cm
            pieza(ovalo(0.12, 0.07, 0.07), 0, 0.72, n + '_columna', cer, 0.01)
            pieza(ovalo(fondo * 0.45, fondo * 0.45, ancho * 0.48), 0.72, 0.86, n, cer, 0.02)
            pieza(ovalo(fondo * 0.48, fondo * 0.3, ancho * 0.35), 0.82, 0.861, n + '_seno', acabado('ceramica', '#e6e6e4'), 0.002)
        else:  # pie + taza ovalada (+ tapa y cisterna en el váter)
            pieza(ovalo(fondo * 0.45, fondo * 0.25, ancho * 0.22), 0, 0.3, n + '_pie', cer, 0.02)
            pieza(ovalo(fondo * 0.5, fondo * 0.42, ancho * 0.38), 0.3, 0.4, n + '_taza', cer, 0.03)
            if t == 'vater':
                pieza(ovalo(fondo * 0.52, fondo * 0.4, ancho * 0.37), 0.4, 0.43, n + '_tapa', cer, 0.01)
                pieza(lado(b, pared, 0.18).buffer(-0.02, join_style=2), 0.38, 0.78, n + '_cisterna', cer, 0.02)
            else:
                pieza(ovalo(fondo * 0.5, fondo * 0.28, ancho * 0.26), 0.399, 0.401, n + '_seno', acabado('ceramica', '#e6e6e4'), 0.001)
    elif t == 'butaca':  # butaca de madera: patas finas, cojines y reposabrazos de listón
        r = mb.get('respaldo', 'y+'); tela = acabado('tela', mb.get('color', '#e7ddcf'))
        madera = acabado('madera', mb.get('color2', '#c9a274'))
        brazos = ('y-', 'y+') if r[0] == 'x' else ('x-', 'x+')
        x0b, y0b, x1b, y1b = b.bounds; e = 0.03
        for j, (px, py) in enumerate([(x0b, y0b), (x1b - e, y0b), (x0b, y1b - e), (x1b - e, y1b - e)]):
            pieza(box(px, py, px + e, py + e), 0, 0.58, n + f'_pata{j}', madera, 0.006)
        interior = b
        for br in brazos: interior = interior.difference(lado(b, br, 0.06))
        pieza(interior, 0.2, 0.24, n + '_bastidor', madera, 0.006)
        pieza(interior.difference(lado(b, r, 0.12)), 0.24, 0.38, n + '_cojin', tela, 0.035)
        pieza(lado(interior, r, 0.12), 0.24, alto, n + '_respaldo', tela, 0.035)
        for j, br in enumerate(brazos): pieza(lado(b, br, 0.06), 0.56, 0.59, n + f'_brazo{j}', madera, 0.008)
    elif t == 'silla_oficina':  # base de 5 radios con ruedas, columna, asiento, respaldo alto y brazos
        negro = acabado('tela', mb.get('color', '#202022')); metal = acabado('metal', '#3a3a3c')
        c0 = b.centroid; rr = min(b.bounds[2] - b.bounds[0], b.bounds[3] - b.bounds[1]) / 2
        for k in range(5):
            a_ = 2 * math.pi * k / 5; ex, ey = c0.x + math.cos(a_) * rr, c0.y + math.sin(a_) * rr
            pieza(LineString([(c0.x, c0.y), (ex, ey)]).buffer(0.018, cap_style=2), 0.05, 0.08, n + f'_radio{k}', metal, 0.004)
            pieza(Point(ex, ey).buffer(0.025, 12), 0, 0.05, n + f'_rueda{k}', acabado('lacado', '#111111'), 0.01)
        pieza(c0.buffer(0.025, 16), 0.08, 0.42, n + '_columna', metal, 0.004)
        asiento = c0.buffer(rr * 0.92, cap_style=3).intersection(b.buffer(0.02))
        pieza(asiento, 0.42, 0.5, n + '_asiento', negro, 0.03)
        r = mb.get('respaldo', 'x+')
        pieza(lado(asiento, r, 0.05), 0.55, CORTE - 0.03, n + '_respaldo', negro, 0.02)
        for j, br in enumerate(('y-', 'y+') if r[0] == 'x' else ('x-', 'x+')):
            pieza(lado(asiento, br, 0.05).intersection(asiento.difference(lado(asiento, r, 0.12))), 0.62, 0.66, n + f'_brazo{j}', negro, 0.01)
    elif t == 'monitor':  # pantalla fina sobre peana; 'frente' = hacia dónde mira la pantalla
        f = mb.get('frente', 'x+'); desde = mb.get('desde', 75) * M
        pieza(b.centroid.buffer(0.09, cap_style=3), desde, desde + 0.012, n + '_peana', acabado('metal', '#2b2b2d'), 0.003)
        pieza(b.centroid.buffer(0.02, cap_style=3), desde, desde + 0.12, n + '_brazo', acabado('metal', '#2b2b2d'), 0.003)
        atras = {'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+'}[f]
        pantalla = lado(b, atras, 0.025)
        pieza(pantalla, desde + 0.1, min(alto, CORTE - 0.02), n + '_marco', acabado('lacado', '#151517'), 0.004)
        pieza(lado(pantalla, f, 0.004), desde + 0.115, min(alto, CORTE - 0.02) - 0.012, n + '_imagen',
              acabado('ceramica', '#0b1a2a'), 0.001)
    elif t == 'inodoro':
        cer = acabado('ceramica', mb.get('color', '#f7f7f5'))
        rr = min(b.bounds[2] - b.bounds[0], b.bounds[3] - b.bounds[1]) / 2 * 0.95
        pieza(b.centroid.buffer(rr * 0.7), 0, alto * 0.75, n + '_pie', cer, 0.01)
        pieza(b.centroid.buffer(rr), alto * 0.75, alto, n, cer, 0.015)
    elif t == 'planta':
        rr = (b.bounds[2] - b.bounds[0]) / 2
        pieza(b.centroid.buffer(rr * 0.6), 0, alto * 0.3, n + '_maceta', MAT['maceta'], 0.01)
        esferas(n + '_hojas', (b.centroid.x, b.centroid.y), rr * 1.1, alto * 0.3, alto, 9, acabado('planta', mb.get('color', '#4f6f34')), i)
    elif t == 'tendedero':
        met = acabado('metal', mb.get('color', '#c8c8c8'))
        extruir(b.difference(b.buffer(-0.02, join_style=2)), alto - 0.02, alto, n, met)
        for j in range(1, 6):
            x0b, y0b, x1b, y1b = b.bounds; xx = x0b + (x1b - x0b) * j / 6
            extruir(box(xx - 0.004, y0b, xx + 0.004, y1b), alto - 0.02, alto, n + f'_v{j}', met)
    else:
        pieza(b, 0, alto, n, col)
for i, mb in enumerate(L.get('muebles', [])):
    mueble(i, mb)

# ---------- techo y parte alta de los muros: invisibles a la cámara, pero frenan la luz ----------
# (si no, la luz de una habitación se escapa por encima de los muros cortados a las de al lado)
TECHO = L.get('altura_techo', 285) * M
def ocultar(ob):
    ob.visible_camera = False
    if not a.noche:  # de día: frena el sol directo (sombra) pero deja entrar la luz del cielo rebotada
        ob.visible_diffuse = False; ob.visible_glossy = False
if a.techo or a.noche:
    cortes_alto = sorted({CORTE, TECHO} | {z for _, d, h in huecos for z in (d, h) if CORTE < z < TECHO})
    for i, (z0, z1) in enumerate(zip(cortes_alto[:-1], cortes_alto[1:])):
        quitar = unary_union([g for g, d, h in huecos if d <= z0 + 1e-6 and h >= z1 - 1e-6] or [Polygon()])
        ob = extruir(muros2d.difference(quitar), z0, z1, f'muro_alto_{i}', MAT['muro'])
        if ob: ocultar(ob)
    ob = extruir(huella, TECHO, TECHO + 0.05, 'techo', MAT['muro'])
    if ob: ocultar(ob)

# ---------- luces de la casa (casa/luces.json) ----------
import os
ruta_luces = os.path.join(os.path.dirname(os.path.abspath(a.layout)), 'luces.json')
LZ = json.load(open(ruta_luces))['luces'] if os.path.exists(ruta_luces) else []
if a.luces == 'todas': elegidas = LZ
elif a.luces == 'ninguna': elegidas = []
else:
    pedir = {t.strip() for t in a.luces.split(',')}
    elegidas = [l for l in LZ if str(l['n']) in pedir or (l.get('entidad') or '') in pedir]
CALIDA = (1.0, 0.70, 0.42)  # ~2700 K
TIPOS = {  # tipo → (clase de luz, potencia W, radio m)
    'foco': ('SPOT', 28, 0.03), 'colgante': ('POINT', 30, 0.12), 'mesa': ('POINT', 14, 0.08),
    'techo': ('POINT', 40, 0.15), 'aplique': ('POINT', 10, 0.05)}
for l in elegidas:
    clase, pot, rad = TIPOS.get(l['tipo'], ('POINT', 20, 0.1))
    for j, (px, py) in enumerate(l.get('puntos') or [(l['x'], l['y'])]):
        ld = bpy.data.lights.new(f"luz_{l['n']}_{j}", clase); ld.energy = pot; ld.color = CALIDA
        ld.shadow_soft_size = rad
        if clase == 'SPOT': ld.spot_size = math.radians(100); ld.spot_blend = 0.7
        lo_ = bpy.data.objects.new(ld.name, ld); sc.collection.objects.link(lo_)
        lo_.location = (px * M, py * M, min(l.get('z', 250) * M, TECHO - 0.03))

# ---------- sol (azimut real) y cielo ----------
azY = L.get('orientacion', {}).get('azimut_eje_+Y', 180.0)
s_az, s_el = map(float, a.sol.split(','))
ang = math.radians(s_az - azY)  # ángulo en el plano, horario desde +Y
hacia_sol = Vector((math.sin(ang) * math.cos(math.radians(s_el)), math.cos(ang) * math.cos(math.radians(s_el)), math.sin(math.radians(s_el))))
sun = bpy.data.lights.new('sol', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.5)
if a.noche:  # luz de luna: débil y azulada
    sun.energy = 0.4; sun.color = (0.62, 0.72, 1.0)
so = bpy.data.objects.new('sol', sun); sc.collection.objects.link(so)
so.rotation_euler = hacia_sol.to_track_quat('Z', 'Y').to_euler()
w = bpy.data.worlds.new('cielo'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.95, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
if a.noche:
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.07, 0.16, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3

# ---------- cámara de diorama: 30° desde la vertical, girada 25° ----------
minx, miny, maxx, maxy = huella.bounds
c = Vector(((minx + maxx) / 2, (miny + maxy) / 2, 0.3))
t = math.radians(a.inclinacion if a.inclinacion is not None else L.get('camara', {}).get('inclinacion_desde_vertical', 30))
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
if a.blend:
    sc['azimut_eje_y'] = azY
    t_ = bpy.data.texts.new('luces.json'); t_.write(json.dumps(LZ, ensure_ascii=False))
    t_ = bpy.data.texts.new('layout.json'); t_.write(json.dumps(L, ensure_ascii=False))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend), compress=True)
    print('blend ->', a.blend)
if not a.sin_render:
    bpy.ops.render.render(write_still=True)
    print('render ->', a.salida)
