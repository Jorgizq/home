"""Genera todas las imágenes del diorama a partir de casa.blend.

Se ejecuta dentro de Blender (no necesita nada más):
  Mac:      doble clic en renderizar.command
  Windows:  doble clic en renderizar.bat
  A mano:   blender -b casa.blend -P renderizar.py -- [--solo noche,luces,sol] [--muestras 128] [--res 1600x1200]

Imágenes (en salida/):
  noche.jpg             la casa a oscuras, solo luz de luna
  sol_azAAA_elEE.jpg    de día, con el sol en azimut AAA y elevación EE (rejilla de 15°, solo
                        las posiciones que el sol alcanza en Madrid a lo largo del año)
  luz_NN.jpg            SOLO la luz que aporta la lámpara NN de luces.json, sobre negro:
                        la tarjeta la suma encima de la imagen de base
Si se interrumpe, al relanzarlo continúa: no repite las imágenes que ya existen.
"""
import bpy, sys, os, json, math, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(nombre, defecto):
    return argv[argv.index(nombre) + 1] if nombre in argv else defecto
SOLO = set(opt('--solo', 'noche,luces,sol').split(','))
MUESTRAS = int(opt('--muestras', '128'))
RX, RY = map(int, opt('--res', '1600x1200').split('x'))
MAXIMO = int(opt('--max', '100000'))  # como mucho N imágenes en esta tanda
AQUI = os.path.dirname(bpy.data.filepath) or os.getcwd()
SALIDA = os.path.join(AQUI, 'salida'); os.makedirs(SALIDA, exist_ok=True)
LAT, LON = 40.4011, -3.6975  # Madrid

sc = bpy.context.scene
LUCES = json.loads(bpy.data.texts['luces.json'].as_string())
AZ_Y = float(sc.get('azimut_eje_y', 183.8))

# ---------- gráfica: Metal (Mac), OptiX/CUDA (NVIDIA), HIP (AMD), oneAPI (Intel) ----------
def activar_gpu():
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
    except KeyError:
        return 'CPU'
    for tipo in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = tipo
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != 'CPU']
        if gpus:
            for d in prefs.devices: d.use = True
            sc.cycles.device = 'GPU'
            return f"{tipo}: {', '.join(d.name for d in gpus)}"
    sc.cycles.device = 'CPU'
    return 'CPU'
print('Render con', activar_gpu())

sc.render.engine = 'CYCLES'; sc.cycles.samples = MUESTRAS; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = RX, RY; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 92

sol = bpy.data.objects['sol']; mundo = sc.world.node_tree.nodes['Background']
altos = [o for o in bpy.data.objects if o.name.startswith('muro_alto_') or o.name == 'techo']
lamparas = {}  # n → [objetos de luz]
for o in bpy.data.objects:
    if o.type == 'LIGHT' and o.name.startswith('luz_'):
        lamparas.setdefault(int(o.name.split('_')[1]), []).append(o)

def preparar(modo, luz=None, az=None, el=None):
    dia = modo == 'dia'
    for o in altos:  # el techo frena el sol/luna directos; los rebotes del cielo solo se frenan en las capas de lámparas
        o.visible_diffuse = (modo == 'luz'); o.visible_glossy = (modo == 'luz')
    for n, obs in lamparas.items():
        for o in obs: o.hide_render = (n != luz)
    sol.hide_render = (modo == 'luz')
    if dia:
        ang = math.radians(az - AZ_Y)
        v = (math.sin(ang) * math.cos(math.radians(el)), math.cos(ang) * math.cos(math.radians(el)), math.sin(math.radians(el)))
        from mathutils import Vector
        sol.rotation_euler = Vector(v).to_track_quat('Z', 'Y').to_euler()
        sol.data.energy = 3.2; sol.data.color = (1, 1, 1)
        mundo.inputs['Color'].default_value = (0.75, 0.82, 0.95, 1); mundo.inputs['Strength'].default_value = 0.45
    elif modo == 'noche':
        sol.data.energy = 0.4; sol.data.color = (0.62, 0.72, 1.0)
        mundo.inputs['Color'].default_value = (0.05, 0.07, 0.16, 1); mundo.inputs['Strength'].default_value = 0.3
    else:  # solo la lámpara, sobre negro
        mundo.inputs['Strength'].default_value = 0.0

# ---------- posiciones del sol en Madrid a lo largo del año ----------
def sol_madrid(dia, minuto_utc):
    g = 2 * math.pi / 365 * (dia - 1 + (minuto_utc / 60 - 12) / 24)
    eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
           + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    h = math.radians((minuto_utc + eq + 4 * LON) / 4 - 180); la = math.radians(LAT)
    el = math.degrees(math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(h)))
    az = (math.degrees(math.atan2(math.sin(h), math.cos(h) * math.sin(la) - math.tan(dec) * math.cos(la))) + 180) % 360
    return az, el
camino = [sol_madrid(d, m) for d in range(1, 366, 3) for m in range(0, 1440, 10)]
camino = [(az, el) for az, el in camino if el > 0]
ELEV = [5, 15, 30, 45, 60, 72]
rejilla = sorted({(az, el) for az in range(0, 360, 15) for el in ELEV
                  if any(abs((az - a + 180) % 360 - 180) <= 10 and abs(el - e) <= 8 for a, e in camino)})

trabajos = []
if 'noche' in SOLO: trabajos.append(('noche.jpg', dict(modo='noche')))
if 'luces' in SOLO:
    for l in LUCES: trabajos.append((f"luz_{l['n']:02d}.jpg", dict(modo='luz', luz=l['n'])))
if 'sol' in SOLO:
    for az, el in rejilla: trabajos.append((f'sol_az{az:03d}_el{el:02d}.jpg', dict(modo='dia', az=az, el=el)))

# ---------- dónde cae cada cosa en la imagen (para iconos y zonas táctiles de la tarjeta) ----------
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
def a_imagen(x, y, z):
    v = world_to_camera_view(sc, sc.camera, Vector((x, y, z)))
    return [round(v.x, 4), round(1 - v.y, 4)]  # 0..1 desde la esquina superior izquierda
LAYOUT = json.loads(bpy.data.texts['layout.json'].as_string()) if 'layout.json' in bpy.data.texts else {'habitaciones': {}}
habitaciones = {k: dict(nombre=h['nombre'], area=h.get('area_ha_id'),
                        poligono=[a_imagen(px / 100, py / 100, 0.0) for px, py in h['poligono']],
                        centro=a_imagen(sum(p[0] for p in h['poligono']) / len(h['poligono']) / 100,
                                        sum(p[1] for p in h['poligono']) / len(h['poligono']) / 100, 0.9))
                for k, h in LAYOUT['habitaciones'].items()}
indice = dict(resolucion=[RX, RY], azimut_eje_y=AZ_Y, habitaciones=habitaciones, sol=[dict(az=az, el=el, archivo=f'sol_az{az:03d}_el{el:02d}.jpg') for az, el in rejilla],
              luces=[dict(n=l['n'], entidad=l.get('entidad'), nombre=l['nombre'], habitacion=l['habitacion'], tipo=l['tipo'],
                          icono=a_imagen(l['x'] / 100, l['y'] / 100, 1.0 if l['tipo'] in ('foco', 'techo', 'colgante') else min(l.get('z', 90), 120) / 100),
                          archivo=f"luz_{l['n']:02d}.jpg") for l in LUCES])
json.dump(indice, open(os.path.join(SALIDA, 'indice.json'), 'w'), indent=1, ensure_ascii=False)

pendientes = [t for t in trabajos if not os.path.exists(os.path.join(SALIDA, t[0]))][:MAXIMO]
print(f'{len(trabajos)} imágenes en total, {len(pendientes)} pendientes')
t0 = time.time()
for i, (nombre, kw) in enumerate(pendientes, 1):
    preparar(**kw)
    sc.render.filepath = os.path.join(SALIDA, nombre)
    bpy.ops.render.render(write_still=True)
    media = (time.time() - t0) / i
    print(f'[{i}/{len(pendientes)}] {nombre}  ·  quedan ~{media * (len(pendientes) - i) / 60:.0f} min', flush=True)
print('Terminado:', SALIDA)
