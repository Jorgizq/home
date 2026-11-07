# Diorama de la casa (Home Assistant)

Proyecto de Jorge: diorama de su piso para un panel de Home Assistant, siguiendo la guía
[danderik88/home-diorama](https://github.com/danderik88/home-diorama). Todo en **español**.
Rama de trabajo: `claude/intelligent-hypatia-tapfw6` (`main` solo tiene el escaneo y las fotos originales).

## Estado (actualizar al terminar cada tarea)
- ✅ Plano a partir de escaneo LiDAR + correcciones de Jorge → `casa/layout.json`
- ✅ Modelo Blender con muebles y acabados → `casa/modelo.py`
- ✅ 110 renders (noche, 33 capas de luz, 76 posiciones del sol) → `render/salida/`
- ✅ Áreas creadas en HA (planta "Vivienda"); ids en `layout.json` (`area_ha_id`)
- ✅ Tarjeta `ha/home-3d-card.js` v0.5.0 (`kiosk: <usuario>` oculta barra y menú sin HACS; encaja en pantalla `fit`; tono 2200–4000 K; panel con brillo y temperatura; pulsación larga = ventana de HA) (sol, luces con fundido, iconos, panel, tiempo, hora dorada/azul, hojas, murciélagos, aviones, golondrinas)
- ✅ HA enlazado al repo: clon parcial en `/config/www/diorama`; actualizar con `git -C www/diorama pull`
  y subir `?v=` del recurso `/local/diorama/ha/home-3d-card.js` cuando cambie la tarjeta (va por `?v=8`)
- ✅ Tablet en la pared (Samsung Galaxy Tab, Android): usuario `tablet`, app de HA, `kiosk: tablet`, `fit: cover`,
  pantalla activa y app fijada (pasos en `ha/INSTALAR.md`)
- ✅ Dispositivos de HA revisados (nov 2026): 24 TRADFRI (DIRIGERA por Matter), 6 mandos, Denon AVR-X1400H (salón),
  Sonos Era 300 ×2 en pareja (`media_player.oficina_oficina`, despacho), Epson (tendedero). Sin aspirador, persianas,
  clima ni sensores de puertas. Las luces **no** tienen área en HA (la tarjeta no la necesita).
- ✅ 2 regletas Shelly Power Strip 4 Gen4 en el despacho, un enchufe por aparato (`switch.despacho_*`, `sensor.despacho_*_potencia`
  / `_energia`), todas en el panel de Energía: Regleta 1 = Sonos 1, aire, libre, Sonos 2 · Regleta 2 = monitor derecho, mesa,
  dock ThinkPad, monitor izquierdo. El aire es el split de la antigua terraza (sobre la ventana del despacho).
- ✅ Tarjeta v0.6.0: aparatos en vivo (`render/salida/aparatos.json`): pantallas de los monitores y brillo en el escritorio,
  tele (color cambiante), notas en Denon y Sonos al reproducir, flechas de la mesa al moverse, aire soplando; el panel
  de la habitación muestra cada aparato con sus W y el total. Demo «Aparatos» en la pastilla del tiempo.
- ✅ Tele LG OLED65C1 en HA (LG webOS, 192.168.1.52, área Salón): `media_player.television` y `switch.television_pantalla`;
  en `casa/aparatos.json` y en el panel `dashboard-diorama` (`devices: {tele: media_player.television}`).
- ⏳ Siguiente: Alexa Devices (temperatura por habitación).

## Cómo trabajar desde el escritorio
- Para hablar con HA: navegador (Claude in Chrome). Desde el portátil de empresa la terminal no llega a HA; desde el Mac sí debería.
- Para renderizar en local: Blender 5.2 instalado y `render/renderizar.command` (Mac) o `renderizar.bat` (Windows).
  Sin Blender, `pip install bpy==5.2.3 trimesh shapely mapbox_earcut` y usar Blender como módulo de Python.
- Las imágenes de `render/salida/` se versionan en git (HA las baja con `git pull`).
- Cada cambio de la tarjeta: subir `VERSION` dentro del `.js` y avisar a Jorge de que suba `?v=` en Recursos.
- Aparatos (monitores, tele, altavoces, aire…): posición en cm y entidades en `casa/aparatos.json`; luego
  `python tools/aparatos.py` los proyecta a `render/salida/aparatos.json` (recupera la cámara de los iconos de `indice.json`, sin Blender).
  Ojo: los iconos se proyectaron a 1 m (focos/techo/colgantes) o a su z (máx. 1,20 m); los muros están cortados a 1,40 m.
- Probar la tarjeta antes de publicarla: servidor local con una copia de `render/salida/` y un `hass` simulado en Playwright.

## Estructura
| Ruta | Qué es |
|---|---|
| `casa/layout.json` | Plano: habitaciones (polígonos), aberturas, ventanas, muebles, orientación, cámara. **cm**, +Y = sur (fachada del salón), +X = oeste, origen esquina inferior izquierda del escaneo enderezado (giro 24,6°) |
| `casa/aparatos.json` | Aparatos dibujados en vivo (tipo, x/y/z en cm, entidades de estado y potencia) → `tools/aparatos.py` |
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
