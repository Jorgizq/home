# Diorama de la casa (Home Assistant)

Proyecto de Jorge: diorama de su piso para un panel de Home Assistant, siguiendo la guía
[danderik88/home-diorama](https://github.com/danderik88/home-diorama). Todo en **español**.
Rama de trabajo: `claude/intelligent-hypatia-tapfw6` (`main` solo tiene el escaneo y las fotos originales).

## Estado (actualizar al terminar cada tarea)
- ✅ Plano a partir de escaneo LiDAR + correcciones de Jorge → `casa/layout.json`
- ✅ Modelo Blender con muebles y acabados → `casa/modelo.py`
- ✅ 110 renders (noche, 33 capas de luz, 76 posiciones del sol) → `render/salida/`
- ✅ Áreas creadas en HA (planta "Vivienda"); ids en `layout.json` (`area_ha_id`)
- ✅ Tarjeta `ha/home-3d-card.js` v0.3.1 (encaja en la pantalla: `fit: contain|cover|width`) (sol, luces con fundido, iconos, panel, tiempo, hora dorada/azul, hojas, murciélagos, aviones, golondrinas)
- ✅ HA enlazado al repo: clon parcial en `/config/www/diorama`; actualizar con `git -C www/diorama pull`
  y subir `?v=` del recurso `/local/diorama/ha/home-3d-card.js` cuando cambie la tarjeta (va por `?v=5`)
- ⏳ Siguiente: listar dispositivos de HA (aspirador, media_player, persianas, sensores…) para nuevos efectos
- ⬜ Tablet en la pared (usuario propio, kiosk-mode)

## Estructura
| Ruta | Qué es |
|---|---|
| `casa/layout.json` | Plano: habitaciones (polígonos), aberturas, ventanas, muebles, orientación, cámara. **cm**, +Y = sur (fachada del salón), +X = oeste, origen esquina inferior izquierda del escaneo enderezado (giro 24,6°) |
| `casa/luces.json` | Puntos de luz (n, tipo, x/y/z en cm, entidad de HA o `null` = interruptor sin domótica) |
| `casa/modelo.py` | Construye la escena desde layout.json y renderiza (Blender como módulo `bpy` 5.2.3) |
| `render/casa.blend` + `render/renderizar.py` | Escena lista + script que genera todas las imágenes y `indice.json` (reanudable; `--solo`, `--max`, `--muestras`) |
| `render/salida/` | Imágenes publicadas que lee la tarjeta + `indice.json` (posiciones en imagen de luces/habitaciones, vectores de cámara) |
| `ha/home-3d-card.js` | Tarjeta Lovelace `custom:home-3d-card` (config: `path`, opcionales `sun`, `weather`, `icons`, `rooms`, `effects`) |
| `ha/INSTALAR.md`, `ha/ACTUALIZAR.md` | Instalación y actualización en HA |
| `tools/escaneo/` | Scripts del escaneo (rejillas, alzados, vista cenital, techo, mapa de luces) |
| `tools/ha/crear_areas.js` | Crea áreas/planta y asigna luces desde la consola del navegador de HA |
| `fotos/<habitación>/` | Fotos de referencia de cada estancia |

## Reglas y decisiones
- **La cámara es fija** (desde el oeste, 30° desde la vertical, girada 25°). Cambiarla obliga a re-renderizar todo.
- Qué obliga a re-renderizar: mueble/color/geometría → todo; luz nueva → solo su `luz_NN.jpg` (+ `indice.json`);
  cambiar entidad de una luz → solo `indice.json` (`renderizar.py --max 0`). Lo que se mueve (tiempo, robot…) se dibuja en vivo en la tarjeta.
- Tras cambiar `layout.json`/`luces.json`: reconstruir `render/casa.blend`
  (`python casa/modelo.py casa/layout.json /dev/null --techo --luces todas --blend render/casa.blend --sin-render`).
- Orientación real (OSM): fachada del salón a 183,8° (Calle del Ferrocarril, Madrid). Luces TRADFRI a ~2700 K.
- Antes de cambiar algo, enseñar a Jorge una imagen (render, plano o detalle), no código.
- Jorge usa un portátil Windows de empresa: PowerShell/curl **no** llegan a HA (bloqueo del equipo), solo el navegador.
  HA en `http://homeassistant.local` (sin puerto). Tiene también un Mac M1 (más potente para Blender).
- Nunca subir tokens al repo.

## Habitaciones (clave layout → área HA)
salon→salon · comedor→comedor · hall→hall · despacho→despacho · dormitorio_principal→dormitorio ·
dormitorio_2→segundo_dormitorio · distribuidor→distribuidor · bano_1→bano_grande · bano_2→bano_pequeno ·
cocina→cocina · pasillo→pasillo · tendedero→tendedero
