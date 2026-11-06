# Instalar el diorama en Home Assistant

## 1. Copiar los archivos a Home Assistant
Todo va a la carpeta `/config/www/home-3d/` de Home Assistant:
- el contenido de `render/salida/` (las imágenes `.jpg` y `indice.json`)
- `ha/home-3d-card.js`

Desde el navegador, la forma más sencilla es el complemento **Studio Code Server**
(Ajustes → Complementos → Tienda): ábrelo, crea la carpeta `www/home-3d` y arrastra los archivos.

## 2. Registrar la tarjeta
Ajustes → Paneles de control → ⋮ (arriba a la derecha) → **Recursos** → Añadir recurso:
- URL: `/local/home-3d/home-3d-card.js?v=1`
- Tipo: **Módulo JavaScript**

> Cada vez que se actualice `home-3d-card.js`, sube el número de `?v=` o la tablet seguirá usando la versión vieja.

## 3. Crear el panel
Ajustes → Paneles de control → Añadir panel → "Diorama". Ábrelo → ✏️ → ⋮ → Editor de configuración en bruto:

```yaml
views:
  - title: Casa
    path: casa
    type: panel
    cards:
      - type: custom:home-3d-card
        path: /local/home-3d/
        # fit: contain   # cabe entera en la pantalla (por defecto)
        # fit: cover     # llena la pantalla recortando bordes (tablet en la pared)
        # header: 0      # con kiosk-mode, que no hay barra arriba
```

## Qué hace
- De día muestra la imagen con el sol en su posición real (`sun.sun`) y la funde con la de noche al anochecer.
- Cada luz encendida en Home Assistant se ilumina en el diorama con su brillo y su temperatura de color.
- Toca un icono de luz para encenderla o apagarla, o una habitación para ver sus luces.
- Encima se dibuja el tiempo real (lluvia, nieve, nubes, niebla, tormenta) y, de abril a septiembre, golondrinas.
  La pastilla del tiempo (abajo a la izquierda) cambia de efecto al tocarla, para probarlos.
