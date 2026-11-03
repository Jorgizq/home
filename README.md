# Diorama de casa

Diorama de la casa para Home Assistant, siguiendo la guía de
[danderik88/home-diorama](https://github.com/danderik88/home-diorama).

## Estado
1. ✅ Escaneo LiDAR (`ferrocarril_15_16_08.zip`, OBJ texturizado, eje Y arriba, metros).
2. ✅ Primer plano a partir del escaneo (`docs/escaneo/`).
3. ⏳ Nombrar habitaciones y generar `layout.json`.

## Datos del escaneo
- Planta de ~9,2 × 13,5 m; suelo a −0,05 m y techo a ~2,85 m.
- Paredes giradas 24,25° respecto a los ejes del escaneo; los scripts lo enderezan.

## Scripts (`tools/escaneo/`)
```bash
pip install trimesh shapely matplotlib numpy scipy pillow
unzip ferrocarril_15_16_08.zip -d scans/raw
python tools/escaneo/plan.py scans/raw/textured_output.obj scans/plan          # corte de paredes
python tools/escaneo/topview.py scans/raw/textured_output.obj scans/raw/textured_output.jpg scans/plan_top.png 1.3
python tools/escaneo/label.py scans/plan_top.png scans/plan_numerado.png
```
