# Diorama de casa

Diorama de la casa para Home Assistant, siguiendo la guía de
[danderik88/home-diorama](https://github.com/danderik88/home-diorama).

## Estado
1. ✅ Escaneo LiDAR (`ferrocarril_15_16_08.zip`: OBJ con textura, eje Y arriba, metros).
2. ✅ Plano (borrador 2): `casa/layout.json` → `docs/escaneo/plano.png`. Fachada del salón al sur.
3. ✅ Orientación real (OpenStreetMap): fachada del salón a 183,8° (sur, 4° al oeste).
4. ✅ Modelo en Blender y primer render en gris: `docs/render/prueba_1.png`.
5. ⬜ Muebles a partir de fotos, texturas y luces.

## Datos del escaneo
- Vivienda de ~9 × 14 m; techo a ~2,85 m.
- Plano en cm, origen en la esquina inferior izquierda, paredes enderezadas (giro 24,6°).

## Scripts (`tools/escaneo/`)
```bash
pip install trimesh shapely matplotlib numpy scipy pillow
unzip ferrocarril_15_16_08.zip -d scans/raw
O=scans/raw/textured_output
python tools/escaneo/rejillas.py $O.obj scans/rejillas.npz                     # 1. escaneo → rejillas de planta
python tools/escaneo/lineas.py scans/rejillas.npz scans/lineas.json 0.5        # 2. caras de pared rectas (ayuda para trazar)
python tools/escaneo/dibujar_layout.py casa/layout.json scans/rejillas.npz docs/escaneo/plano.png
python tools/escaneo/vista_cenital.py $O.obj $O.jpg scans/rejillas.npz docs/escaneo/vista_cenital.png 1.3 casa/layout.json
```
`alzado.py` saca la vista de frente de una pared (para ver puertas y ventanas):
```bash
python tools/escaneo/alzado.py $O.obj $O.jpg scans/rejillas.npz salida.png 900 1372 0 1372 45   # fachada sur
```
`ventanas.py` intenta detectar ventanas comparando la pared a 0,6–0,9 m y a 1,4–1,9 m (poco fiable con cortinas).

## Modelo 3D (`casa/modelo.py`)
```bash
pip install bpy==5.2.3 trimesh shapely mapbox_earcut
python casa/modelo.py casa/layout.json docs/render/prueba_1.png --res 1600x1200 --muestras 64 [--blend casa.blend] [--sol 200,40]
```
Muros cortados a 1,40 m, cámara de diorama (30° desde la vertical, girada 25°) y sol con su azimut real.
