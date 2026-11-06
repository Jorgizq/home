# Enlazar Home Assistant con el repo (para actualizar con un solo comando)

En vez de copiar las imágenes a mano, Home Assistant se descarga del repo solo lo que necesita
(`ha/` y `render/salida/`, unos 30 MB; ni fotos ni escaneo) dentro de `www/diorama`.

## Una sola vez
1. Studio Code Server → menú ☰ → **Terminal → New Terminal**.
2. Comprueba que estás en la carpeta de Home Assistant: `ls` debe mostrar `configuration.yaml` y `www`.
3. Pega esto y pulsa Enter:

```bash
git clone --depth 1 --filter=blob:none --no-checkout --branch claude/intelligent-hypatia-tapfw6 https://github.com/Jorgizq/home.git www/diorama && cd www/diorama && git sparse-checkout set --no-cone '/render/salida/' '/ha/' && git checkout claude/intelligent-hypatia-tapfw6 && cd ../.. && ls www/diorama/render/salida | wc -l
```

   Al final debe salir `111` (110 imágenes + `indice.json`).
4. Ajustes → Paneles de control → ⋮ → **Recursos**: cambia la URL de la tarjeta a
   `/local/diorama/ha/home-3d-card.js?v=2`
5. En el panel Diorama (✏️ → ⋮ → Editor de configuración en bruto) cambia `path` a:

```yaml
        path: /local/diorama/render/salida/
```

6. Recarga con Ctrl+F5. Si se ve bien, ya puedes borrar la carpeta antigua `www/home-3d`.

## Cada vez que haya cambios
En la terminal de Studio Code Server:

```bash
git -C www/diorama pull
```

Si el cambio incluye una versión nueva de la tarjeta, sube también el número de `?v=` en Recursos
(te lo diré cuando toque). Si algún día el repo pasa a privado, el `pull` pedirá un token de GitHub.
