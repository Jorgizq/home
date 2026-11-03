/*
 * home-3d-card · diorama de la casa para Home Assistant
 *
 * Apila imágenes pre-renderizadas en Blender (render/salida/):
 *   - de día, las dos imágenes de sol más cercanas a la posición real de sun.sun, fundidas
 *   - al atardecer funde con la imagen de noche
 *   - encima, la capa de cada luz encendida (se suma a la imagen: mix-blend-mode plus-lighter),
 *     con el brillo y la temperatura de color reales de la bombilla
 *   - iconos de luz (toque = encender/apagar) y zonas de habitación (toque = panel con sus luces)
 *
 * Configuración mínima:
 *   type: custom:home-3d-card
 *   path: /local/home-3d/
 * Opcionales:
 *   sun: sun.sun
 *   icons: true            # mostrar iconos de luz
 *   rooms: true            # zonas táctiles de habitación
 */
const VERSION = '0.1.0';

class Home3dCard extends HTMLElement {
  setConfig(config) {
    if (!config.path) throw new Error('Falta "path" (carpeta con indice.json y las imágenes)');
    this._config = { sun: 'sun.sun', icons: true, rooms: true, ...config };
    this._path = this._config.path.endsWith('/') ? this._config.path : this._config.path + '/';
    this._firma = '';
    if (!this._root) this._montar();
    this._cargarIndice();
  }

  getCardSize() { return 8; }

  set hass(hass) {
    this._hass = hass;
    if (!this._indice) return;
    // Solo redibuja si ha cambiado algo que la tarjeta usa (HA manda muchas actualizaciones por segundo).
    const firma = this._entidades().map((e) => {
      const s = hass.states[e];
      if (!s) return '';
      if (e === this._config.sun) return `${Math.round(s.attributes.azimuth)}|${Math.round(s.attributes.elevation * 2)}`;
      return `${s.state}|${s.attributes.brightness || ''}|${s.attributes.color_temp_kelvin || ''}`;
    }).join(';');
    if (firma === this._firma) return;
    this._firma = firma;
    this._pintar();
  }

  // ---------- montaje ----------
  _montar() {
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; background: #111; }
        .escena { position: relative; width: 100%; }
        .escena img { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
                      user-select: none; -webkit-user-drag: none; pointer-events: none; }
        .luz { mix-blend-mode: plus-lighter; transition: opacity .4s; }
        .sol, .noche { transition: opacity 1.5s; }
        svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        .zona { fill: transparent; stroke: transparent; cursor: pointer; }
        .zona:hover { fill: rgba(255,255,255,.06); }
        .icono { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
                 border: 2px solid rgba(255,255,255,.85); background: rgba(20,20,20,.45); cursor: pointer;
                 box-shadow: 0 1px 4px rgba(0,0,0,.5); transition: background .3s, box-shadow .3s; padding: 0; }
        .icono.on { background: #ffc46b; box-shadow: 0 0 10px 3px rgba(255,190,90,.7); }
        .panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); min-width: 220px;
                 background: rgba(28,28,30,.92); color: #eee; border-radius: 14px; padding: 12px 14px;
                 font: 14px/1.4 var(--paper-font-body1_-_font-family, system-ui, sans-serif); box-shadow: 0 6px 24px rgba(0,0,0,.5); }
        .panel h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
        .panel .fila { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0;
                       border-top: 1px solid rgba(255,255,255,.08); cursor: pointer; }
        .panel .estado { font-size: 12px; opacity: .7; }
        .panel .fila.on .estado { color: #ffc46b; opacity: 1; }
        .panel .cerrar { position: absolute; top: 6px; right: 10px; cursor: pointer; opacity: .6; font-size: 18px; }
        .aviso { color: #ccc; padding: 16px; font: 14px system-ui, sans-serif; }
      </style>
      <ha-card><div class="escena"><div class="aviso">Cargando el diorama…</div></div></ha-card>`;
    this._escena = this._root.querySelector('.escena');
  }

  async _cargarIndice() {
    try {
      const r = await fetch(`${this._path}indice.json?v=${VERSION}`, { cache: 'no-cache' });
      this._indice = await r.json();
    } catch (e) {
      this._escena.innerHTML = `<div class="aviso">No encuentro ${this._path}indice.json</div>`;
      return;
    }
    const [w, h] = this._indice.resolucion;
    this._escena.innerHTML = '';
    this._escena.style.aspectRatio = `${w} / ${h}`;
    this._solA = this._img('sol'); this._solB = this._img('sol');
    this._noche = this._img('noche'); this._noche.src = this._path + 'noche.jpg';
    this._capaLuces = document.createElement('div'); this._escena.appendChild(this._capaLuces);
    this._luces = {};  // entidad → <img>, solo mientras está encendida (las imágenes ocultas también gastan memoria)
    if (this._config.rooms) this._montarZonas();
    if (this._config.icons) this._montarIconos();
    this._firma = '';
    if (this._hass) this.hass = this._hass;
  }

  _img(clase) {
    const i = document.createElement('img'); i.className = clase; i.alt = ''; i.decoding = 'async';
    this._escena.appendChild(i); return i;
  }

  _montarZonas() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const [W, H] = this._indice.resolucion;  // coordenadas en píxeles de la imagen (con 0..1 Chrome falla al detectar toques)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const [clave, hab] of Object.entries(this._indice.habitaciones || {})) {
      const p = document.createElementNS(ns, 'polygon');
      p.setAttribute('points', hab.poligono.map(([u, v]) => `${(u * W).toFixed(1)},${(v * H).toFixed(1)}`).join(' '));
      p.setAttribute('class', 'zona');
      p.addEventListener('click', (ev) => { ev.stopPropagation(); this._abrirPanel(clave); });
      svg.appendChild(p);
    }
    this._escena.appendChild(svg);
    this._escena.addEventListener('click', () => this._cerrarPanel());
  }

  _montarIconos() {
    this._iconos = {};
    for (const l of this._indice.luces) {
      if (!l.entidad) continue;
      const b = document.createElement('button');
      b.className = 'icono'; b.title = l.nombre;
      b.style.left = `${l.icono[0] * 100}%`; b.style.top = `${l.icono[1] * 100}%`;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); this._alternar(l.entidad); });
      this._escena.appendChild(b);
      this._iconos[l.entidad] = b;
    }
  }

  // ---------- estado ----------
  _entidades() {
    return [this._config.sun, ...this._indice.luces.filter((l) => l.entidad).map((l) => l.entidad)];
  }

  _alternar(entidad) {
    this._hass.callService('light', 'toggle', { entity_id: entidad });
  }

  _pintar() {
    this._pintarSol();
    this._pintarLuces();
    if (this._panelAbierto) this._abrirPanel(this._panelAbierto);
  }

  _pintarSol() {
    const s = this._hass.states[this._config.sun];
    const az = s ? Number(s.attributes.azimuth) : 180;
    const el = s ? Number(s.attributes.elevation) : 45;
    // noche: del todo por debajo de -6° (fin del crepúsculo civil), nada por encima de 5°
    const noche = Math.min(1, Math.max(0, (5 - el) / 11));
    this._noche.style.opacity = noche;
    // día: las dos posiciones de sol renderizadas más cercanas, fundidas según la distancia
    const elc = Math.max(5, el);
    const dist = (p) => {
      const da = ((p.az - az + 540) % 360) - 180;
      return Math.hypot(da * Math.cos((elc * Math.PI) / 180), p.el - elc);
    };
    const [a, b] = [...this._indice.sol].sort((p, q) => dist(p) - dist(q));
    const src = (p) => this._path + p.archivo;
    if (!this._solA.src.endsWith(a.archivo)) this._solA.src = src(a);
    if (b && !this._solB.src.endsWith(b.archivo)) this._solB.src = src(b);
    const da = dist(a), db = b ? dist(b) : Infinity;
    this._solB.style.opacity = b ? da / (da + db || 1) : 0;
    this._solA.style.opacity = 1;
  }

  _pintarLuces() {
    for (const l of this._indice.luces) {
      if (!l.entidad) continue;
      const s = this._hass.states[l.entidad];
      const on = s && s.state === 'on';
      if (this._iconos && this._iconos[l.entidad]) this._iconos[l.entidad].classList.toggle('on', !!on);
      let img = this._luces[l.entidad];
      if (!on) { if (img) { img.remove(); delete this._luces[l.entidad]; } continue; }
      if (!img) {
        img = document.createElement('img'); img.className = 'luz'; img.alt = '';
        img.src = this._path + l.archivo; this._capaLuces.appendChild(img); this._luces[l.entidad] = img;
      }
      const bri = s.attributes.brightness != null ? s.attributes.brightness / 255 : 1;
      img.style.opacity = (0.2 + 0.8 * bri).toFixed(2);
      // render a 2700 K: con luz más fría se le quita saturación (más blanca)
      const k = s.attributes.color_temp_kelvin;
      const frio = k ? Math.min(1, Math.max(0, (k - 2700) / 3800)) : 0;
      img.style.filter = frio ? `saturate(${(1 - 0.85 * frio).toFixed(2)}) brightness(${(1 + 0.1 * frio).toFixed(2)})` : '';
    }
  }

  // ---------- panel de habitación ----------
  _abrirPanel(clave) {
    const hab = this._indice.habitaciones[clave];
    const luces = this._indice.luces.filter((l) => l.habitacion === clave && l.entidad);
    this._cerrarPanel(false);
    this._panelAbierto = clave;
    const div = document.createElement('div'); div.className = 'panel';
    div.addEventListener('click', (ev) => ev.stopPropagation());
    const filas = luces.map((l) => {
      const s = this._hass.states[l.entidad];
      const on = s && s.state === 'on';
      const bri = on && s.attributes.brightness != null ? ` · ${Math.round((s.attributes.brightness / 255) * 100)} %` : '';
      return `<div class="fila${on ? ' on' : ''}" data-e="${l.entidad}"><span>${l.nombre}</span>
              <span class="estado">${on ? 'encendida' + bri : 'apagada'}</span></div>`;
    }).join('');
    div.innerHTML = `<span class="cerrar">×</span><h3>${hab.nombre}</h3>${filas || '<div class="estado">Sin luces en Home Assistant</div>'}`;
    div.querySelector('.cerrar').addEventListener('click', () => this._cerrarPanel());
    div.querySelectorAll('.fila').forEach((f) => f.addEventListener('click', () => this._alternar(f.dataset.e)));
    this._escena.appendChild(div); this._panel = div;
  }

  _cerrarPanel(olvidar = true) {
    if (this._panel) { this._panel.remove(); this._panel = null; }
    if (olvidar) this._panelAbierto = null;
  }
}

customElements.define('home-3d-card', Home3dCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'home-3d-card', name: 'Home 3D (diorama)', description: 'Diorama de la casa con el sol y las luces reales' });
console.info(`%c home-3d-card ${VERSION} `, 'background:#ffc46b;color:#222;border-radius:3px');
