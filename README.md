# Diorama de casa

Diorama de la casa para Home Assistant, siguiendo la guía de
[danderik88/home-diorama](https://github.com/danderik88/home-diorama).

## Estado
1. ✅ Escaneo LiDAR (`ferrocarril_15_16_08.zip`: OBJ con textura, eje Y arriba, metros).
2. ✅ Borrador 1 del plano: `casa/layout.json` → `docs/escaneo/plano_borrador_1.png`.
3. ⏳ Confirmar puertas, ventanas y dudas (lista `dudas` en `layout.json`).
4. ⬜ Modelo en Blender y primer render.

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
python tools/escaneo/dibujar_layout.py casa/layout.json scans/rejillas.npz docs/escaneo/plano_borrador_1.png
python tools/escaneo/vista_cenital.py $O.obj $O.jpg scans/rejillas.npz docs/escaneo/vista_cenital.png 1.3 casa/layout.json
```
`ventanas.py` intenta detectar ventanas comparando la pared a 0,6–0,9 m y a 1,4–1,9 m (poco fiable con cortinas).
