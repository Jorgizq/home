#!/bin/bash
# Mac: doble clic para generar todas las imágenes del diorama en la carpeta salida/.
cd "$(dirname "$0")"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [ ! -x "$B" ]; then
  echo "No encuentro Blender en /Applications. Instálalo desde https://www.blender.org/download/ (versión 5.2, Apple Silicon)."
  read -n 1 -s -r -p "Pulsa una tecla para cerrar"; exit 1
fi
"$B" -b casa.blend -P renderizar.py -- "$@"
read -n 1 -s -r -p "Listo. Pulsa una tecla para cerrar"
