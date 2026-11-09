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
 *   weather: weather.casa  # entidad del tiempo (por defecto, la primera weather.* que haya)
 *   effects: true          # lluvia, nieve, nubes, niebla, tormenta, hojas, golondrinas, murciélagos y aviones
 *   devices:               # aparatos dibujados en vivo (render/salida/aparatos.json): monitores, tele, música, mesa, aire
 *     tele: media_player.lg_c1   # cambia la entidad de un aparato por su id · devices: false = sin aparatos
 *   energy: /dashboard-diorama/energia   # pastilla «⚡ … € hoy» que abre la página de energía (custom:home-energy-card)
 *   fit: contain           # contain = cabe entera en la pantalla (por defecto) · cover = llena la pantalla recortando bordes
 *                          # · width = ocupa todo el ancho (como antes)
 *   header: 56px           # alto de la barra de HA que hay que descontar (0 con kiosk-mode)
 *   kiosk: tablet          # oculta la barra de arriba y el menú lateral de HA (sin HACS):
 *                          #   true = para todos · nombre de usuario (o lista) = solo para ese usuario
 *                          #   Para editar el panel en ese dispositivo, añade ?editar a la dirección.
 * Tocar la pastilla del tiempo (abajo a la izquierda) prueba los efectos aunque no esté lloviendo.
 */
const VERSION = '0.7.0';

class Home3dCard extends HTMLElement {
  setConfig(config) {
    if (!config.path) throw new Error('Falta "path" (carpeta con indice.json y las imágenes)');
    this._config = { sun: 'sun.sun', icons: true, rooms: true, effects: true, fit: 'contain', ...config };
    this._path = this._config.path.endsWith('/') ? this._config.path : this._config.path + '/';
    this._firma = '';
    if (!this._root) this._montar();
    this._cargarIndice();
  }

  getCardSize() { return 8; }

  set hass(hass) {
    this._hass = hass;
    this._kiosko();
    if (!this._indice) return;
    if (this._pastillaEnergia) {
      this._iniciarEnergia();
      if (Date.now() - (this._energiaPintada || 0) > 30e3) this._pintarEnergia();
    }
    // Solo redibuja si ha cambiado algo que la tarjeta usa (HA manda muchas actualizaciones por segundo).
    const firma = this._entidades().map((e) => {
      const s = hass.states[e];
      if (!s) return '';
      if (e === this._config.sun) return `${Math.round(s.attributes.azimuth)}|${Math.round(s.attributes.elevation * 2)}`;
      if (e.startsWith('weather.')) return `${s.state}|${s.attributes.temperature}|${s.attributes.wind_speed}|${s.attributes.wind_bearing}`;
      return `${s.state}|${s.attributes.brightness || ''}|${s.attributes.color_temp_kelvin || ''}`;
    }).join(';') + '#' + this._firmaAparatos();
    const fPanel = this._firmaPanel();  // los vatios cambian a menudo: solo refrescan el panel abierto
    if (firma === this._firma) {
      if (fPanel !== this._fPanel) { this._fPanel = fPanel; if (this._panelAbierto && !this._arrastrando) this._abrirPanel(this._panelAbierto); }
      return;
    }
    this._firma = firma; this._fPanel = fPanel;
    this._pintar();
  }

  // ---------- montaje ----------
  _montar() {
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; background: #111; position: relative; }
        .escena { position: relative; width: 100%; }
        /* encajar en la pantalla: el alto disponible es la ventana menos la barra de HA */
        ha-card.ajustar { height: calc(100vh - var(--cabecera)); height: calc(100dvh - var(--cabecera));
                          display: flex; align-items: center; justify-content: center; }
        ha-card.contain .escena { flex: none; width: min(100%, calc((100vh - var(--cabecera)) * var(--ar)));
                                  width: min(100%, calc((100dvh - var(--cabecera)) * var(--ar))); }
        ha-card.cover .escena { flex: none; width: max(100%, calc((100vh - var(--cabecera)) * var(--ar)));
                                width: max(100%, calc((100dvh - var(--cabecera)) * var(--ar))); }
        .escena img { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
                      user-select: none; -webkit-user-drag: none; pointer-events: none; }
        .luz { mix-blend-mode: plus-lighter; transition: opacity .4s; }
        .sol, .noche { transition: opacity 1.5s; }
        .tinte { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light; transition: opacity 2s, background 2s; }
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
        .panel .lista { max-height: 60vh; overflow-y: auto; }
        .panel .luzfila { border-top: 1px solid rgba(255,255,255,.08); }
        .panel .luzfila .fila { border-top: 0; }
        .panel .mandos { display: grid; gap: 4px; padding: 0 0 8px; }
        .panel .mandos label { display: flex; align-items: center; gap: 8px; font-size: 13px; opacity: .85; }
        .panel input[type=range] { flex: 1; accent-color: #ffc46b; min-width: 150px; }
        .panel input.kelvin { accent-color: #ffe2b0; background: linear-gradient(90deg, #ffb14e, #fff4e6); border-radius: 4px; height: 6px; }
        .aviso { color: #ccc; padding: 16px; font: 14px system-ui, sans-serif; }
        canvas.aparatos { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        canvas.aparatos.brillo { mix-blend-mode: plus-lighter; }
        .panel h3 .total { float: right; margin-left: 16px; margin-right: 18px; font-size: 13px; font-weight: 500; color: #ffc46b; }
        .panel .seccion { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .5; padding: 8px 0 2px; }
        canvas.clima { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .destello { position: absolute; inset: 0; background: #dfe8ff; opacity: 0; pointer-events: none; mix-blend-mode: screen; }
        .pastillas { position: absolute; left: 2%; bottom: 3%; display: flex; gap: 8px; }
        .tiempo.energia b { color: #ffc46b; }
        .tiempo { display: flex; align-items: center; gap: 8px; padding: 6px 12px;
                  border-radius: 999px; border: 0; background: rgba(20,20,22,.6); color: #eee; cursor: pointer;
                  font: 600 14px/1 var(--paper-font-body1_-_font-family, system-ui, sans-serif); backdrop-filter: blur(6px); }
        .tiempo .icono-t { font-size: 18px; } .tiempo .demo { font-size: 11px; font-weight: 500; color: #ffc46b; }
      </style>
      <ha-card><div class="escena"><div class="aviso">Cargando el diorama…</div></div></ha-card>`;
    this._escena = this._root.querySelector('.escena');
  }

  async _cargarIndice() {
    try {
      const r = await fetch(`${this._path}indice.json?v=${VERSION}`, { cache: 'no-cache' });
      this._indice = await r.json();
      this._listaAparatos = [];
      if (this._config.devices !== false) {
        const ra = await fetch(`${this._path}aparatos.json?v=${VERSION}`, { cache: 'no-cache' }).catch(() => null);
        if (ra && ra.ok) this._listaAparatos = (await ra.json()).aparatos || [];
      }
    } catch (e) {
      this._escena.innerHTML = `<div class="aviso">No encuentro ${this._path}indice.json</div>`;
      return;
    }
    const [w, h] = this._indice.resolucion;
    this._escena.innerHTML = '';
    this._escena.style.aspectRatio = `${w} / ${h}`;
    const card = this._root.querySelector('ha-card'), fit = this._config.fit;
    card.className = fit === 'contain' || fit === 'cover' ? `ajustar ${fit}` : '';
    card.style.setProperty('--ar', (w / h).toFixed(4));
    const cab = this._config.header ?? 'var(--header-height, 56px)';
    card.style.setProperty('--cabecera', typeof cab === 'number' ? `${cab}px` : cab);
    this._solA = this._img('sol'); this._solB = this._img('sol');
    this._noche = this._img('noche'); this._noche.src = this._path + 'noche.jpg';
    this._tinte = document.createElement('div'); this._tinte.className = 'tinte'; this._escena.appendChild(this._tinte);
    this._capaLuces = document.createElement('div'); this._escena.appendChild(this._capaLuces);
    this._dibujoAparatos = this._listaAparatos.length ? new Aparatos(this._escena, this._listaAparatos, this._indice.camara) : null;
    if (this._config.effects) {
      this._clima = new Clima(this._escena, this._indice);
      this._pastilla = document.createElement('button'); this._pastilla.className = 'tiempo';
      this._pastilla.addEventListener('click', (ev) => { ev.stopPropagation(); this._siguienteDemo(); });
    }
    this._luces = {};  // entidad → <img>, solo mientras está encendida (las imágenes ocultas también gastan memoria)
    if (this._config.rooms) this._montarZonas();
    if (this._config.icons) this._montarIconos();
    if (this._config.energy) {
      this._pastillaEnergia = document.createElement('button'); this._pastillaEnergia.className = 'tiempo energia';
      this._pastillaEnergia.innerHTML = '<span class="icono-t">⚡</span><span>Energía</span>';
      this._pastillaEnergia.addEventListener('click', (ev) => { ev.stopPropagation(); navegar(this._config.energy); });
    }
    if (this._pastilla || this._pastillaEnergia) {  // pegadas a la pantalla, no a la imagen: siempre visibles
      const caja = document.createElement('div'); caja.className = 'pastillas';
      for (const p of [this._pastilla, this._pastillaEnergia]) if (p) caja.appendChild(p);
      card.appendChild(caja);
    }
    this._firma = '';
    this._kioskoAplicado = undefined;
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
      let temporizador = null, largo = false;
      b.addEventListener('pointerdown', () => {
        largo = false; temporizador = setTimeout(() => { largo = true; this._masInfo(l.entidad); }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, () => clearTimeout(temporizador)));
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (!largo) this._alternar(l.entidad); });
      b.addEventListener('contextmenu', (ev) => ev.preventDefault());
      this._escena.appendChild(b);
      this._iconos[l.entidad] = b;
    }
  }

  // ---------- modo kiosko (sin HACS) ----------
  _kioskoActivo() {
    const k = this._config.kiosk;
    if (!k || /[?&]editar\b/.test(location.search)) return false;
    if (k === true) return true;
    const nombre = (this._hass && this._hass.user && this._hass.user.name || '').toLowerCase();
    return [].concat(k).some((u) => String(u).toLowerCase() === nombre);
  }

  _kiosko() {
    const activo = this._kioskoActivo();
    const card = this._root && this._root.querySelector('ha-card');
    if (card && this._config.header == null)  // sin barra de HA no hay que descontar su alto
      card.style.setProperty('--cabecera', activo ? '0px' : 'var(--header-height, 56px)');
    if (activo === this._kioskoAplicado) return;
    this._kioskoAplicado = activo;
    // Busca en el árbol de HA (atravesando shadow roots) los elementos de la barra y el menú.
    const buscar = (raiz, sel, prof = 0) => {
      if (!raiz || prof > 8) return null;
      const e = raiz.querySelector(sel); if (e) return e;
      for (const n of raiz.querySelectorAll('*')) { if (n.shadowRoot) { const r = buscar(n.shadowRoot, sel, prof + 1); if (r) return r; } }
      return null;
    };
    const ha = document.querySelector('home-assistant');
    const main = ha && ha.shadowRoot && ha.shadowRoot.querySelector('home-assistant-main');
    const huiRoot = buscar(document, 'hui-root');
    const estilo = (raiz, id, css) => {
      if (!raiz) return;
      let st = raiz.querySelector(`style#${id}`);
      if (!activo) { if (st) st.remove(); return; }
      if (!st) { st = document.createElement('style'); st.id = id; raiz.appendChild(st); }
      st.textContent = css;
    };
    estilo(huiRoot && huiRoot.shadowRoot, 'diorama-kiosko',
      `.header, app-header, ha-app-layout > app-header, .toolbar { display: none !important; }
       :host { --header-height: 0px !important; }
       #view { padding-top: 0 !important; margin-top: 0 !important; min-height: 100vh !important; }`);
    estilo(main && main.shadowRoot, 'diorama-kiosko',
      `ha-sidebar { display: none !important; }
       ha-drawer { --mdc-drawer-width: 0px !important; }
       partial-panel-resolver { --mdc-top-app-bar-width: 100% !important; }`);
    if (main && main.shadowRoot) {  // la variante antigua del menú lateral (app-drawer)
      const drawer = main.shadowRoot.querySelector('ha-drawer, app-drawer-layout');
      if (drawer && drawer.shadowRoot) estilo(drawer.shadowRoot, 'diorama-kiosko',
        `.mdc-drawer, aside { display: none !important; } .mdc-drawer-app-content { margin-left: 0 !important; }`);
    }
  }

  // ---------- estado ----------
  _entidades() {
    const t = this._entidadTiempo();
    return [this._config.sun, ...(t ? [t] : []), ...this._indice.luces.filter((l) => l.entidad).map((l) => l.entidad)];
  }

  _entidadTiempo() {
    if (this._config.weather) return this._config.weather;
    if (!this._hass) return null;
    return Object.keys(this._hass.states).find((e) => e.startsWith('weather.')) || null;
  }

  _masInfo(entidad) {  // la ventana estándar de HA con todos los controles de la luz
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: entidad }, bubbles: true, composed: true }));
  }

  _alternar(entidad) {
    this._hass.callService('light', 'toggle', { entity_id: entidad });
  }

  _pintar() {
    this._pintarSol();
    this._pintarLuces();
    this._pintarAparatos();
    this._pintarTiempo();
    if (this._panelAbierto && !this._arrastrando) this._abrirPanel(this._panelAbierto);
  }

  _pintarSol() {
    const s = this._hass.states[this._config.sun];
    const d = this._demo || {};
    const az = d.az ?? (s ? Number(s.attributes.azimuth) : 180);
    const el = d.el ?? (s ? Number(s.attributes.elevation) : 45);
    // hora dorada (sol bajo) y hora azul (justo después de ponerse)
    if (el > 0 && el < 12) { this._tinte.style.background = '#ffb54d'; this._tinte.style.opacity = (0.55 * (1 - el / 12)).toFixed(2); }
    else if (el <= 0 && el > -7) { this._tinte.style.background = '#5a6cff'; this._tinte.style.opacity = (0.5 * Math.min(1, -el / 3)).toFixed(2); }
    else this._tinte.style.opacity = 0;
    // noche: del todo por debajo de -6° (fin del crepúsculo civil), nada por encima de 5°
    const noche = Math.min(1, Math.max(0, (5 - el) / 11));
    this._noche.style.opacity = noche; this._nocheF = noche;
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
      if (!on) {  // se apaga con un fundido y luego se quita (las imágenes ocultas también gastan memoria)
        if (img) { img.style.opacity = 0; delete this._luces[l.entidad]; setTimeout(() => img.remove(), 450); }
        continue;
      }
      let nueva = false;
      if (!img) {
        img = document.createElement('img'); img.className = 'luz'; img.alt = ''; img.style.opacity = 0; nueva = true;
        img.src = this._path + l.archivo; this._capaLuces.appendChild(img); this._luces[l.entidad] = img;
      }
      const bri = s.attributes.brightness != null ? s.attributes.brightness / 255 : 1;
      const objetivo = (0.2 + 0.8 * bri).toFixed(2);
      if (nueva) requestAnimationFrame(() => requestAnimationFrame(() => { img.style.opacity = objetivo; }));
      else img.style.opacity = objetivo;
      // render a 2700 K: con luz más fría se le quita saturación (más blanca)
      img.style.filter = Home3dCard._tono(s.attributes.color_temp_kelvin);
    }
  }

  // Las capas están renderizadas a 2700 K: más frío → menos saturado (más blanco); más cálido → más ámbar.
  static _tono(k) {
    if (!k || Math.abs(k - 2700) < 60) return '';
    if (k > 2700) {
      const f = Math.min(1, (k - 2700) / 2800);
      return `saturate(${(1 - 0.8 * f).toFixed(2)}) hue-rotate(${(-6 * f).toFixed(1)}deg) brightness(${(1 + 0.08 * f).toFixed(2)})`;
    }
    const f = Math.min(1, (2700 - k) / 500);  // 2200 K = f 1
    return `sepia(${(0.35 * f).toFixed(2)}) saturate(${(1 + 0.6 * f).toFixed(2)}) hue-rotate(${(-8 * f).toFixed(1)}deg) brightness(${(1 - 0.08 * f).toFixed(2)})`;
  }

  // ---------- aparatos (monitores, tele, música, mesa elevable, aire) ----------
  _ent(a) { const d = this._config.devices; return (d && d[a.id]) || a.estado || null; }

  _vatios(a) {  // suma de los sensores de potencia del aparato (null si no tiene o no hay datos)
    if (!a.potencia || !this._hass) return null;
    let t = 0, hay = false;
    for (const e of a.potencia) {
      const s = this._hass.states[e], v = s ? parseFloat(s.state) : NaN;
      if (Number.isFinite(v)) { t += v; hay = true; }
    }
    return hay ? t : null;
  }

  _activo(a) {
    const e = this._ent(a);
    if (e) {
      const s = this._hass.states[e]; if (!s) return false;
      if (a.tipo === 'altavoz') return s.state === 'playing';
      return !['off', 'standby', 'unavailable', 'unknown'].includes(s.state);
    }
    if (a.tipo === 'tele' || a.tipo === 'altavoz') return false;
    const w = this._vatios(a);
    return w != null && w > (a.umbral ?? 5);
  }

  _firmaAparatos() {
    return (this._listaAparatos || []).map((a) => (this._activo(a) ? 1 : 0)).join('') + (this._demo && this._demo.aparatos ? 'd' : '');
  }

  _firmaPanel() {
    if (!this._panelAbierto || !this._listaAparatos) return '';
    return this._listaAparatos.filter((a) => a.habitacion === this._panelAbierto).map((a) => {
      const w = this._vatios(a), e = this._ent(a), s = e && this._hass.states[e];
      return `${w == null ? '' : Aparatos.vatios(w)}|${s ? s.state : ''}`;
    }).join(';');
  }

  _pintarAparatos() {
    if (!this._dibujoAparatos) return;
    const demo = this._demo && this._demo.aparatos;  // la demo enciende todo (para ver la tele antes de tenerla en HA)
    const activos = new Set(this._listaAparatos.filter((a) => demo || this._activo(a)).map((a) => a.id));
    this._dibujoAparatos.poner(activos, this._nocheF ?? 1);
  }

  _filaAparato(a) {
    const w = this._vatios(a), on = this._activo(a), e = this._ent(a), s = e && this._hass.states[e];
    const MEDIA = { playing: 'reproduciendo', paused: 'en pausa', idle: 'parado', on: 'encendido', off: 'apagado', standby: 'en espera',
      buffering: 'cargando', unavailable: 'no disponible', unknown: 'sin datos' };
    let txt;
    if (a.tipo === 'altavoz' || a.tipo === 'tele') txt = s ? (MEDIA[s.state] || s.state) : (e ? 'no disponible' : 'sin conectar a HA');
    else if (a.tipo === 'mesa') txt = on ? 'moviéndose' : 'en reposo';
    else if (a.tipo === 'aire') txt = on ? 'encendido' : 'en reposo';
    else if (a.tipo === 'enchufe') txt = on ? '' : 'apagado';
    else txt = on ? 'encendido' : 'apagado';
    if (w != null && (on || w >= 0.5)) txt = (txt ? txt + ' · ' : '') + `${Aparatos.vatios(w)} W`;
    const info = a.info || e;
    return `<div class="luzfila${on ? ' on' : ''}"><div class="fila"${info ? ` data-info="${info}"` : ''}><span>${a.nombre}</span>
            <span class="estado">${txt || '—'}</span></div></div>`;
  }

  // ---------- pastilla de energía (lee la tarifa de la tarjeta de energía de esa página) ----------
  async _iniciarEnergia() {
    if (this._energiaIniciada || !this._hass) return;
    this._energiaIniciada = true;
    let cfg = null;
    try {
      const [, panel, vista] = this._config.energy.split('?')[0].split('/');
      const lv = await this._hass.callWS({ type: 'lovelace/config', url_path: panel });
      for (const v of lv.views || []) {
        if (vista && v.path !== vista) continue;
        cfg = [...(v.cards || []), ...(v.sections || []).flatMap((s) => s.cards || [])].find((c) => c.type === 'custom:home-energy-card');
        if (cfg) break;
      }
    } catch (e) { /* sin tarifa: solo lo medido */ }
    this._energia = new Energia({ ...(cfg || {}), devices: { ...(cfg && cfg.devices), ...this._config.devices } }, this._listaAparatos);
    const ciclo = async () => {
      if (!this.isConnected && this._energia.cargadoEn) return;
      try { await this._energia.cargar(this._hass); this._pintarEnergia(); } catch (e) { /* se reintenta en el siguiente ciclo */ }
    };
    ciclo(); setInterval(ciclo, 5 * 60e3);
  }

  _pintarEnergia() {
    if (!this._energia || !this._energia.cargadoEn) return;
    this._energiaPintada = Date.now();
    this._energia.hass = this._hass;
    const r = this._energia.resumen('hoy');
    this._pastillaEnergia.innerHTML = `<span class="icono-t">⚡</span><span><b>${Energia.euros(r.total, 2)}</b> hoy</span>`;
  }

  // ---------- tiempo ----------
  _siguienteDemo() {
    const DEMOS = [null, { estado: 'rainy' }, { estado: 'lightning-rainy', el: -12 }, { estado: 'snowy' }, { estado: 'fog' },
      { estado: 'cloudy' }, { estado: 'sunny', mes: 11, avion: true, nombre: 'Otoño', icono: '🍂' },
      { estado: 'sunny', el: 4, az: 245, nombre: 'Atardecer', icono: '🌇' },
      { estado: 'clear-night', el: -15, mes: 7, nombre: 'Noche de verano', icono: '🦇' },
      { estado: 'clear-night', el: -15, mes: 1, aparatos: true, nombre: 'Aparatos', icono: '🎵' }];
    this._demoIdx = ((this._demoIdx || 0) + 1) % DEMOS.length;
    this._demo = DEMOS[this._demoIdx];
    this._pintar();
  }

  _pintarTiempo() {
    if (!this._clima) return;
    const e = this._entidadTiempo(); const s = e && this._hass.states[e];
    const sol = this._hass.states[this._config.sun];
    const d = this._demo || {};
    const estado = d.estado || (s ? s.state : 'sunny');
    const a = s ? s.attributes : {};
    const el = d.el ?? (sol ? Number(sol.attributes.elevation) : 45);
    this._clima.poner({
      estado, viento: Number(a.wind_speed) || (this._demo ? 15 : 0), rumbo: Number(a.wind_bearing) || 250,
      dia: el > 0, mes: d.mes || new Date().getMonth() + 1, avion: !!d.avion,
    });
    const ICONOS = { sunny: '☀️', 'clear-night': '🌙', partlycloudy: '⛅', cloudy: '☁️', rainy: '🌧️', pouring: '🌧️',
      'lightning-rainy': '⛈️', lightning: '🌩️', snowy: '❄️', 'snowy-rainy': '🌨️', fog: '🌫️', hail: '🌨️', windy: '💨', exceptional: '⚠️' };
    const NOMBRES = { sunny: 'Despejado', 'clear-night': 'Despejado', partlycloudy: 'Algo nuboso', cloudy: 'Nublado', rainy: 'Lluvia',
      pouring: 'Lluvia fuerte', 'lightning-rainy': 'Tormenta', lightning: 'Tormenta', snowy: 'Nieve', 'snowy-rainy': 'Aguanieve',
      fog: 'Niebla', hail: 'Granizo', windy: 'Viento', exceptional: 'Aviso' };
    const temp = a.temperature != null ? `${Math.round(a.temperature)}°` : '';
    this._pastilla.innerHTML = `<span class="icono-t">${d.icono || ICONOS[estado] || '🌡️'}</span><span>${temp} ${d.nombre || NOMBRES[estado] || estado}</span>` +
      (this._demo ? '<span class="demo">demo</span>' : '');
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
      const s = this._hass.states[l.entidad]; if (!s) return '';
      const a = s.attributes, on = s.state === 'on';
      const pct = on && a.brightness != null ? Math.round((a.brightness / 255) * 100) : null;
      const modos = a.supported_color_modes || [];
      const regulable = modos.some((m) => m !== 'onoff');
      const conTemp = modos.includes('color_temp');
      const kmin = a.min_color_temp_kelvin || 2200, kmax = a.max_color_temp_kelvin || 4000;
      const ctrl = on && regulable ? `<div class="mandos">
          <label title="Brillo">☀︎<input type="range" class="brillo" min="1" max="100" value="${pct ?? 100}" data-e="${l.entidad}"></label>
          ${conTemp ? `<label title="Temperatura de color">🌡︎<input type="range" class="kelvin" min="${kmin}" max="${kmax}" step="50"
              value="${a.color_temp_kelvin || kmin}" data-e="${l.entidad}"></label>` : ''}</div>` : '';
      return `<div class="luzfila${on ? ' on' : ''}"><div class="fila" data-e="${l.entidad}"><span>${l.nombre}</span>
              <span class="estado">${on ? (pct != null ? `${pct} %` : 'encendida') + (a.color_temp_kelvin ? ` · ${a.color_temp_kelvin} K` : '') : 'apagada'}</span></div>${ctrl}</div>`;
    }).join('');
    const aps = (this._listaAparatos || []).filter((a) => a.habitacion === clave);
    const ws = aps.map((a) => this._vatios(a)).filter((w) => w != null);
    const total = ws.length ? `<span class="total">${Aparatos.vatios(ws.reduce((x, y) => x + y, 0))} W ahora</span>` : '';
    const filasAp = aps.map((a) => this._filaAparato(a)).join('');
    const cuerpo = filasAp
      ? `<div class="seccion">Aparatos</div>${filasAp}${filas ? `<div class="seccion">Luces</div>${filas}` : ''}`
      : filas || '<div class="estado">Sin luces en Home Assistant</div>';
    div.innerHTML = `<span class="cerrar">×</span><h3>${hab.nombre}${total}</h3><div class="lista">${cuerpo}</div>`;
    div.querySelector('.cerrar').addEventListener('click', () => this._cerrarPanel());
    div.querySelectorAll('.fila[data-e]').forEach((f) => f.addEventListener('click', () => this._alternar(f.dataset.e)));
    div.querySelectorAll('.fila[data-info]').forEach((f) => f.addEventListener('click', () => this._masInfo(f.dataset.info)));
    div.querySelectorAll('input[type=range]').forEach((r) => {
      r.addEventListener('pointerdown', () => { this._arrastrando = true; });
      r.addEventListener('change', () => {
        this._arrastrando = false;
        const datos = r.classList.contains('brillo') ? { brightness_pct: Number(r.value) } : { color_temp_kelvin: Number(r.value) };
        this._hass.callService('light', 'turn_on', { entity_id: r.dataset.e, ...datos });
      });
    });
    this._escena.appendChild(div); this._panel = div;
  }

  _cerrarPanel(olvidar = true) {
    if (this._panel) { this._panel.remove(); this._panel = null; }
    if (olvidar) this._panelAbierto = null;
  }
}

/*
 * Efectos del tiempo dibujados en vivo sobre un canvas (no son imágenes renderizadas).
 * La lluvia y la nieve caen alrededor de la casa (dentro no llueve: hay techo), con salpicaduras
 * al tocar el suelo; las nubes proyectan sombras que se mueven con el viento real; la niebla vela
 * la escena; en tormenta hay relámpagos; de abril a septiembre pasan golondrinas de día.
 * Solo anima mientras hay algo que mover, y se para si la pestaña no está visible.
 */
class Clima {
  constructor(escena, indice) {
    this.escena = escena; this.indice = indice;
    this.cv = document.createElement('canvas'); this.cv.className = 'clima'; escena.appendChild(this.cv);
    this.flash = document.createElement('div'); this.flash.className = 'destello'; escena.appendChild(this.flash);
    this.ctx = this.cv.getContext('2d');
    this.gotas = []; this.charcos = []; this.copos = []; this.nubes = []; this.pajaros = []; this.estado = null;
    this.hojas = []; this.murcielagos = []; this.aviones = [];
    this.cam = indice.camara || { arriba: [0, -0.04], norte: [0, -0.05], este: [0.05, 0] };
    new ResizeObserver(() => this._medir()).observe(escena);
    document.addEventListener('visibilitychange', () => this._arrancar());
    this._medir();
  }

  _medir() {
    const r = this.escena.getBoundingClientRect(); if (!r.width) return;
    const escala = Math.min(1, 1100 / r.width) * Math.min(2, window.devicePixelRatio || 1);  // canvas contenido: memoria y 60 fps
    this.W = this.cv.width = Math.round(r.width * escala); this.H = this.cv.height = Math.round(r.height * escala);
    // la casa (suelo + muros hasta el corte) como un trazado, para no pintar lluvia dentro
    this.casa = new Path2D();
    for (const h of Object.values(this.indice.habitaciones || {})) {
      const pts = [...h.poligono, ...(h.poligono_alto || [])].map(([u, v]) => [u * this.W, v * this.H]);
      const casco = Clima._casco(pts); this.casa.moveTo(...casco[0]);
      for (const p of casco.slice(1)) this.casa.lineTo(...p); this.casa.closePath();
    }
  }

  static _casco(p) {  // envolvente convexa (monotone chain)
    p = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (hi.length >= 2 && x(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }

  poner(t) {
    const e = t.estado;
    this.lluvia = { rainy: 1, pouring: 2.2, 'lightning-rainy': 1.6, 'snowy-rainy': 0.6, hail: 1 }[e] || 0;
    this.nieve = { snowy: 1, 'snowy-rainy': 0.6 }[e] || 0;
    this.nubosidad = { cloudy: 0.22, partlycloudy: 0.12, rainy: 0.2, pouring: 0.25, 'lightning-rainy': 0.28, lightning: 0.25,
      snowy: 0.15, 'snowy-rainy': 0.18, fog: 0.08, windy: 0.1 }[e] || 0;
    if (!t.dia) this.nubosidad = 0;
    this.niebla = e === 'fog' ? 1 : 0;
    this.rayos = e === 'lightning' || e === 'lightning-rainy';
    this.golondrinas = t.dia && t.mes >= 4 && t.mes <= 9 && !this.lluvia && !this.nieve && !this.niebla;
    this.dia = t.dia;
    this.otono = t.dia && (t.mes === 10 || t.mes === 11) && !this.lluvia && !this.nieve;
    this.verano_noche = !t.dia && t.mes >= 3 && t.mes <= 10 && !this.lluvia && !this.nieve;
    // viento: hacia dónde va (rumbo + 180), en la imagen; velocidad en km/h
    const hacia = ((t.rumbo + 180) * Math.PI) / 180, n = this.cam.norte, es = this.cam.este;
    const v = [Math.cos(hacia) * n[0] + Math.sin(hacia) * es[0], Math.cos(hacia) * n[1] + Math.sin(hacia) * es[1]];
    const m = Math.hypot(...v) || 1; this.viento = [v[0] / m, v[1] / m]; this.fuerza = Math.min(1, (t.viento || 0) / 40);
    this.estado = e;
    if (this.nubes.length === 0) for (let i = 0; i < 5; i++) this.nubes.push(this._nube(true));
    if (!this.verano_noche) this.murcielagos = [];
    else if (!this.murcielagos.length) for (let i = 0; i < 7; i++) this.murcielagos.push(this._murcielago());
    if (t.avion) this._lanzarAvion();
    this._programarRayo(); this._programarPajaros(); this._programarAvion(); this._arrancar();
  }

  _activo() {
    return !document.hidden && (this.lluvia || this.nieve || this.nubosidad || this.niebla || this.pajaros.length || this.charcos.length
      || this.otono || this.hojas.length || this.murcielagos.length || this.aviones.length);
  }

  _arrancar() {
    if (this._raf || !this._activo()) return;
    let antes = performance.now();
    const paso = (ahora) => {
      const dt = Math.min(0.05, (ahora - antes) / 1000); antes = ahora;
      this._dibujar(dt);
      this._raf = this._activo() ? requestAnimationFrame(paso) : null;
      if (!this._raf) this.ctx.clearRect(0, 0, this.W, this.H);
    };
    this._raf = requestAnimationFrame(paso);
  }

  _suelo() {  // un punto del suelo fuera de la casa
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * this.W, y = Math.random() * this.H * 1.1 - this.H * 0.05;
      if (!this.ctx.isPointInPath(this.casa, x, y)) return [x, y];
    }
    return null;
  }

  _nube(alAzar) {
    const r = (0.18 + Math.random() * 0.22) * this.W;
    const x = alAzar ? Math.random() * this.W : this.W / 2 - this.viento[0] * (this.W * 0.7 + r) + (Math.random() - 0.5) * this.W;
    const y = alAzar ? Math.random() * this.H : this.H / 2 - this.viento[1] * (this.H * 0.7 + r) + (Math.random() - 0.5) * this.H;
    return { x, y, r, f: 0.6 + Math.random() * 0.8 };
  }

  _dibujar(dt) {
    const c = this.ctx, W = this.W, H = this.H, arr = this.cam.arriba, metro = Math.hypot(...arr) * H;
    c.clearRect(0, 0, W, H);
    const deriva = [this.viento[0] * this.fuerza * W * 0.04, this.viento[1] * this.fuerza * H * 0.04];
    // sombras de nubes
    if (this.nubosidad) {
      const vel = (20 + 90 * this.fuerza) * (W / 1000);
      for (let i = 0; i < this.nubes.length; i++) {
        const n = this.nubes[i]; n.x += this.viento[0] * vel * n.f * dt; n.y += this.viento[1] * vel * n.f * dt;
        if (n.x < -n.r * 1.5 || n.x > W + n.r * 1.5 || n.y < -n.r * 1.5 || n.y > H + n.r * 1.5) this.nubes[i] = this._nube(false);
        const g = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(10,14,30,${this.nubosidad})`); g.addColorStop(1, 'rgba(10,14,30,0)');
        c.fillStyle = g; c.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      }
    }
    // lluvia: cada gota cae desde ~6 m sobre un punto del suelo y salpica al llegar
    if (this.lluvia) {
      const objetivo = Math.round(220 * this.lluvia * (W / 1000));
      while (this.gotas.length < objetivo) {
        const p = this._suelo(); if (!p) break;
        const alto = (4 + Math.random() * 4) * metro;
        this.gotas.push({ x: p[0], y: p[1], h: alto, v: metro * (18 + Math.random() * 6) });
      }
      c.strokeStyle = this.dia ? 'rgba(210,222,240,0.55)' : 'rgba(170,190,230,0.5)'; c.lineWidth = Math.max(1, W / 1100);
      c.beginPath();
      for (let i = this.gotas.length - 1; i >= 0; i--) {
        const g = this.gotas[i]; g.h -= g.v * dt;
        if (g.h <= 0) { this.charcos.push({ x: g.x, y: g.y, t: 0 }); this.gotas.splice(i, 1); continue; }
        const k = g.h / metro, x = g.x + arr[0] * W * k + deriva[0] * k, y = g.y + arr[1] * H * k + deriva[1] * k;
        const largo = 0.5 * metro;
        c.moveTo(x, y); c.lineTo(x - arr[0] * W * 0.5 - deriva[0] * 0.5 / 1, y + largo);
      }
      c.stroke();
    }
    // salpicaduras: anillos que se abren y se desvanecen
    if (this.charcos.length) {
      c.lineWidth = Math.max(1, W / 1400);
      for (let i = this.charcos.length - 1; i >= 0; i--) {
        const s = this.charcos[i]; s.t += dt * 3.2;
        if (s.t >= 1) { this.charcos.splice(i, 1); continue; }
        c.strokeStyle = `rgba(220,230,245,${0.5 * (1 - s.t)})`;
        c.beginPath(); c.ellipse(s.x, s.y, 2 + s.t * metro * 0.25, 1 + s.t * metro * 0.1, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    // nieve: copos lentos que se mecen
    if (this.nieve) {
      const objetivo = Math.round(160 * this.nieve * (W / 1000));
      while (this.copos.length < objetivo) {
        const p = this._suelo(); if (!p) break;
        this.copos.push({ x: p[0], y: p[1], h: (2 + Math.random() * 7) * metro, v: metro * (0.8 + Math.random() * 0.7),
                          fase: Math.random() * 6, r: (0.6 + Math.random() * 1.4) * W / 1000 });
      }
      c.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = this.copos.length - 1; i >= 0; i--) {
        const f = this.copos[i]; f.h -= f.v * dt; f.fase += dt * 2;
        if (f.h <= 0) { this.copos.splice(i, 1); continue; }
        const k = f.h / metro, x = f.x + arr[0] * W * k + Math.sin(f.fase) * metro * 0.15 + deriva[0] * k;
        const y = f.y + arr[1] * H * k + deriva[1] * k;
        c.beginPath(); c.arc(x, y, f.r * 1.6, 0, Math.PI * 2); c.fill();
      }
    } else if (this.copos.length) this.copos = [];
    if (!this.lluvia && this.gotas.length) this.gotas = [];
    // niebla: velo claro con manchas que se desplazan despacio
    if (this.niebla) {
      this.tN = (this.tN || 0) + dt;
      c.fillStyle = this.dia ? 'rgba(225,228,232,0.32)' : 'rgba(120,130,150,0.3)'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 4; i++) {
        const x = ((i * 0.31 + this.tN * 0.012 * (1 + i * 0.3)) % 1.4 - 0.2) * W, y = (0.2 + i * 0.2) * H, r = W * 0.35;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, this.dia ? 'rgba(235,238,242,0.35)' : 'rgba(130,140,160,0.3)'); g.addColorStop(1, 'rgba(235,238,242,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // hojas de otoño: cruzan con el viento, girando, y se posan en el suelo
    if (this.otono || this.hojas.length) {
      const objetivo = this.otono ? Math.round(55 * (W / 1000)) : 0;
      while (this.hojas.length < objetivo) {
        const p = this._suelo(); if (!p) break;
        const col = ['#c8742a', '#a8481e', '#d9a03a', '#8a5a2b', '#b5651d'][Math.floor(Math.random() * 5)];
        this.hojas.push({ x: p[0], y: p[1], h: (2 + Math.random() * 6) * metro, v: metro * (0.5 + Math.random() * 0.5),
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 6, fase: Math.random() * 6, col, s: W * (0.007 + Math.random() * 0.005), suelo: 0 });
      }
      const empuje = (0.4 + this.fuerza) * metro;
      for (let i = this.hojas.length - 1; i >= 0; i--) {
        const f = this.hojas[i];
        if (f.h > 0) { f.h -= f.v * dt; f.rot += f.vr * dt; f.fase += dt * 2.5;
                       f.x += this.viento[0] * empuje * dt * 3; f.y += this.viento[1] * empuje * dt * 3; }
        else { f.suelo += dt; if (f.suelo > 4) { this.hojas.splice(i, 1); continue; } }
        const k = Math.max(0, f.h) / metro, x = f.x + arr[0] * W * k + Math.sin(f.fase) * metro * 0.3, y = f.y + arr[1] * H * k;
        c.save(); c.globalAlpha = f.h > 0 ? 0.95 : Math.max(0, 1 - f.suelo / 4); c.translate(x, y); c.rotate(f.rot);
        c.fillStyle = f.col; c.beginPath(); c.ellipse(0, 0, f.s * 1.2, f.s * 0.55 * Math.abs(Math.cos(f.fase)) + f.s * 0.15, 0, 0, Math.PI * 2);
        c.fill(); c.restore();
        if (f.h > 0) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.ellipse(f.x, f.y, f.s, f.s * 0.5, 0, 0, Math.PI * 2); c.fill(); }
      }
    }
    // murciélagos: vuelo errático alrededor de la casa
    if (this.murcielagos.length) {
      for (const m of this.murcielagos) {
        m.t += dt; m.giro += (Math.random() - 0.5) * 8 * dt;
        m.x += Math.cos(m.giro) * m.v * dt; m.y += Math.sin(m.giro) * m.v * dt * 0.75;
        const dx = m.cx - m.x, dy = m.cy - m.y;  // vuelven hacia su zona
        if (Math.hypot(dx, dy) > m.radio) m.giro = Math.atan2(dy, dx) + (Math.random() - 0.5);
        const ala = Math.sin(m.t * 22 + m.fase), s = m.s;
        c.save(); c.translate(m.x, m.y); c.fillStyle = 'rgba(28,28,38,0.95)'; c.strokeStyle = 'rgba(190,200,240,0.7)'; c.lineWidth = Math.max(1.2, W / 900);
        c.beginPath(); c.moveTo(0, 0);
        c.quadraticCurveTo(-s * 0.6, -s * (0.2 + ala * 0.7), -s * 1.2, -s * ala * 0.4);
        c.quadraticCurveTo(-s * 0.7, s * 0.15, 0, s * 0.25);
        c.quadraticCurveTo(s * 0.7, s * 0.15, s * 1.2, -s * ala * 0.4);
        c.quadraticCurveTo(s * 0.6, -s * (0.2 + ala * 0.7), 0, 0);
        c.fill(); c.stroke(); c.restore();
      }
    }
    // aviones: cruzan muy alto; de día dejan estela, de noche llevan luces que parpadean
    for (let i = this.aviones.length - 1; i >= 0; i--) {
      const a = this.aviones[i]; a.t += dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.estela.push([a.x, a.y]); if (a.estela.length > 140) a.estela.shift();
      if (a.x < -W * 0.2 || a.x > W * 1.2 || a.y < -H * 0.2 || a.y > H * 1.2) { this.aviones.splice(i, 1); continue; }
      const ang = Math.atan2(a.vy, a.vx), s = a.s;
      if (this.dia) {
        c.lineWidth = s * 0.35; c.lineCap = 'round';
        for (let j = 1; j < a.estela.length; j++) {
          c.strokeStyle = `rgba(255,255,255,${0.35 * j / a.estela.length})`;
          c.beginPath(); c.moveTo(...a.estela[j - 1]); c.lineTo(...a.estela[j]); c.stroke();
        }
        c.save(); c.translate(a.x, a.y); c.rotate(ang); c.fillStyle = 'rgba(245,245,250,0.95)';
        c.beginPath(); c.ellipse(0, 0, s * 1.6, s * 0.22, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.moveTo(s * 0.3, 0); c.lineTo(-s * 0.4, -s * 1.3); c.lineTo(-s * 0.7, -s * 1.3); c.lineTo(-s * 0.3, 0);
        c.lineTo(-s * 0.7, s * 1.3); c.lineTo(-s * 0.4, s * 1.3); c.closePath(); c.fill(); c.restore();
      } else {
        const blanco = (a.t % 1.2) < 0.08, rojo = (a.t % 1.0) < 0.5;
        c.save(); c.translate(a.x, a.y); c.rotate(ang);
        if (blanco) { c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.arc(0, 0, s * 0.5, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = rojo ? 'rgba(255,60,60,0.95)' : 'rgba(255,60,60,0.25)'; c.beginPath(); c.arc(-s * 0.5, -s * 1.1, s * 0.25, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(60,255,120,0.8)'; c.beginPath(); c.arc(-s * 0.5, s * 1.1, s * 0.25, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
    // golondrinas: una bandada cruza la imagen batiendo las alas
    if (this.pajaros.length) {
      c.strokeStyle = 'rgba(25,25,30,0.85)'; c.lineWidth = Math.max(1.2, W / 800);
      for (let i = this.pajaros.length - 1; i >= 0; i--) {
        const b = this.pajaros[i]; b.t += dt;
        b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(b.t * 1.7 + b.fase) * W * 0.02 * dt;
        if (b.x < -W * 0.1 || b.x > W * 1.1 || b.y < -H * 0.1 || b.y > H * 1.1) { this.pajaros.splice(i, 1); continue; }
        const ala = Math.sin(b.t * 14 + b.fase) * 0.6, s = b.s, ang = Math.atan2(b.vy, b.vx);
        c.save(); c.translate(b.x, b.y); c.rotate(ang);
        c.beginPath(); c.moveTo(-s * 0.4, -s * (0.9 + ala)); c.quadraticCurveTo(-s * 0.1, -s * 0.2, s * 0.3, 0);
        c.quadraticCurveTo(-s * 0.1, s * 0.2, -s * 0.4, s * (0.9 + ala)); c.stroke(); c.restore();
        // sombra en el suelo
        c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.ellipse(b.x - arr[0] * W * 6, b.y - arr[1] * H * 6, s * 0.5, s * 0.25, 0, 0, Math.PI * 2); c.fill();
      }
    }
  }

  _murcielago() {
    const W = this.W || 1000, H = this.H || 750, p = this._suelo() || [W / 2, H / 2];
    return { x: p[0], y: p[1], cx: p[0], cy: p[1], radio: W * (0.06 + Math.random() * 0.08), giro: Math.random() * 6,
             v: W * (0.09 + Math.random() * 0.05), t: 0, fase: Math.random() * 6, s: W * (0.013 + Math.random() * 0.004) };
  }

  _lanzarAvion() {
    const W = this.W, H = this.H, desdeIzq = Math.random() < 0.5;
    const y0 = (0.1 + Math.random() * 0.8) * H, y1 = (0.1 + Math.random() * 0.8) * H, dur = 22 + Math.random() * 10;
    const x0 = desdeIzq ? -W * 0.1 : W * 1.1, x1 = desdeIzq ? W * 1.1 : -W * 0.1;
    this.aviones.push({ x: x0, y: y0, vx: (x1 - x0) / dur, vy: (y1 - y0) / dur, t: 0, estela: [], s: W * 0.009 });
    this._arrancar();
  }

  _programarAvion() {
    if (this._tAvion) return;  // uno cada pocos minutos, haga el tiempo que haga
    const siguiente = () => { this._tAvion = setTimeout(() => { if (!document.hidden) this._lanzarAvion(); siguiente(); },
                                                          (90 + Math.random() * 240) * 1000); };
    siguiente();
  }

  _programarRayo() {
    clearTimeout(this._tRayo);
    if (!this.rayos) return;
    this._tRayo = setTimeout(() => {
      const f = this.flash, golpe = (o, t) => setTimeout(() => { f.style.transition = 'none'; f.style.opacity = o; }, t);
      golpe(0.55, 0); golpe(0.1, 70); golpe(0.7, 140);
      setTimeout(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; }, 220);
      this._programarRayo();
    }, 4000 + Math.random() * 9000);
  }

  _programarPajaros() {
    clearTimeout(this._tPaj);
    if (!this.golondrinas) return;
    this._tPaj = setTimeout(() => {
      const W = this.W, H = this.H, n = 3 + Math.floor(Math.random() * 5);
      const izq = Math.random() < 0.5, y0 = (0.15 + Math.random() * 0.6) * H, v = W * (0.22 + Math.random() * 0.08);
      for (let i = 0; i < n; i++) this.pajaros.push({ x: izq ? -W * 0.05 - i * W * 0.03 : W * 1.05 + i * W * 0.03,
        y: y0 + (Math.random() - 0.5) * H * 0.08, vx: izq ? v : -v, vy: (Math.random() - 0.5) * H * 0.05,
        t: 0, fase: Math.random() * 6, s: W * (0.008 + Math.random() * 0.003) });
      this._arrancar(); this._programarPajaros();
    }, (this.pajaros.length ? 15000 : 4000) + Math.random() * 20000);
  }
}

/*
 * Aparatos dibujados en vivo (no están en los renders): pantallas encendidas que iluminan lo que
 * tienen delante, la tele cambiando de color, notas que suben de los altavoces que suenan, flechas
 * de la mesa elevable mientras se mueve y el aire acondicionado soplando.
 * Dos lienzos: uno de luz (se suma a la imagen, como las capas de luz) y otro normal (notas, flechas, el split).
 * Posiciones en render/salida/aparatos.json (tools/aparatos.py las proyecta desde casa/aparatos.json).
 */
class Aparatos {
  constructor(escena, lista, cam) {
    this.escena = escena; this.lista = lista;
    this.cam = cam || { arriba: [0, -0.04] };
    this.cvL = document.createElement('canvas'); this.cvL.className = 'aparatos brillo'; escena.appendChild(this.cvL);
    this.cvO = document.createElement('canvas'); this.cvO.className = 'aparatos'; escena.appendChild(this.cvO);
    this.luz = this.cvL.getContext('2d'); this.obj = this.cvO.getContext('2d');
    this.activos = new Set(); this.notas = []; this.t = 0; this.noche = 1; this.proxima = {};
    new ResizeObserver(() => { this._medir(); this._dibujar(0); }).observe(escena);
    document.addEventListener('visibilitychange', () => this._arrancar());
    this._medir();
  }

  static vatios(w) {  // 4,5 · 37 · 650
    return w < 10 ? (Math.round(w * 10) / 10).toLocaleString('es-ES') : String(Math.round(w));
  }

  _medir() {
    const r = this.escena.getBoundingClientRect(); if (!r.width) return;
    const escala = Math.min(1, 1100 / r.width) * Math.min(2, window.devicePixelRatio || 1);
    this.W = this.cvL.width = this.cvO.width = Math.round(r.width * escala);
    this.H = this.cvL.height = this.cvO.height = Math.round(r.height * escala);
  }

  poner(activos, noche) {
    this.activos = activos; this.noche = noche;
    this._arrancar();
    if (!this._raf) this._dibujar(0);
  }

  _animado() {  // las pantallas solas no se mueven: basta con dibujarlas una vez
    return !document.hidden && (this.notas.length ||
      this.lista.some((a) => this.activos.has(a.id) && ['tele', 'altavoz', 'mesa', 'aire'].includes(a.tipo)));
  }

  _arrancar() {
    if (this._raf || !this._animado()) return;
    let antes = performance.now();
    const paso = (ahora) => {
      const dt = Math.min(0.05, (ahora - antes) / 1000); antes = ahora;
      this._dibujar(dt);
      this._raf = this._animado() ? requestAnimationFrame(paso) : null;
      if (!this._raf) this._dibujar(0);
    };
    this._raf = requestAnimationFrame(paso);
  }

  _p([u, v]) { return [u * this.W, v * this.H]; }

  _dibujar(dt) {
    if (!this.W) return;
    const L = this.luz, O = this.obj;
    L.clearRect(0, 0, this.W, this.H); O.clearRect(0, 0, this.W, this.H);
    this.t += dt;
    const k = 0.4 + 0.6 * this.noche;  // de día la luz de una pantalla apenas se nota
    for (const a of this.lista) {
      if (!this.activos.has(a.id)) continue;
      if (a.tipo === 'pantalla') this._pantalla(a, [150, 190, 255], k);
      else if (a.tipo === 'tele') {
        const tt = this.t, h = 215 + 30 * Math.sin(tt * 0.45) + 12 * Math.sin(tt * 1.7);  // la imagen cambia de color
        const parpadeo = 0.88 + 0.12 * Math.sin(tt * 7.3) * Math.sin(tt * 2.9);
        this._pantalla(a, Aparatos._hsl(h, 0.55, 0.68), k * parpadeo);
      } else if (a.tipo === 'altavoz' && dt) this._soltarNotas(a, dt);
      else if (a.tipo === 'mesa' && a.punto) this._flechas(a.punto);
      else if (a.tipo === 'aire') this._aire(a, k);
    }
    this._notas(dt);
  }

  static _hsl(h, s, l) {
    const f = (n) => { const q = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))); };
    return [f(0), f(8), f(4)].map(Math.round);
  }

  _pantalla(a, [r, g, b], k) {
    const L = this.luz;
    if (a.brillo) {  // luz que cae delante (escritorio, alfombra)
      const [cx, cy] = this._p(a.brillo.c), rx = a.brillo.rx * this.W * 2.1, ry = a.brillo.ry * this.H * 2.1;
      L.save(); L.translate(cx, cy); L.scale(1, ry / rx);
      const gr = L.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, `rgba(${r * 0.6},${g * 0.65},${b * 0.8},${k})`); gr.addColorStop(0.45, `rgba(${r * 0.3},${g * 0.35},${b * 0.5},${0.6 * k})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = gr; L.fillRect(-rx, -rx, rx * 2, rx * 2); L.restore();
    }
    if (a.pantalla) {
      const pts = a.pantalla.map((p) => this._p(p));
      L.save(); L.beginPath(); L.moveTo(...pts[0]); for (const p of pts.slice(1)) L.lineTo(...p); L.closePath();
      L.shadowColor = `rgba(${r},${g},${b},${k})`; L.shadowBlur = this.W * 0.012;
      L.fillStyle = `rgba(${r},${g},${b},${0.85 * k})`; L.fill(); L.fill(); L.restore();
    }
  }

  _soltarNotas(a, dt) {
    for (let i = 0; i < (a.emisores || []).length; i++) {
      const clave = `${a.id}${i}`;
      this.proxima[clave] = (this.proxima[clave] ?? Math.random() * 0.6) - dt;
      if (this.proxima[clave] > 0) continue;
      this.proxima[clave] = 0.8 + Math.random() * 0.7;
      this.notas.push({ e: a.emisores[i], t: 0, dur: 2.4 + Math.random() * 0.8, lado: Math.random() < 0.5 ? -1 : 1,
                        fase: Math.random() * 6, g: Math.random() < 0.6 ? '♪' : '♫', s: 0.8 + Math.random() * 0.4 });
    }
  }

  _notas(dt) {
    if (!this.notas.length) return;
    const O = this.obj, W = this.W, H = this.H, metro = Math.abs(this.cam.arriba[1]) * H;
    O.save(); O.textAlign = 'center'; O.textBaseline = 'middle';
    O.shadowColor = 'rgba(0,0,0,0.65)'; O.shadowBlur = W * 0.004; O.shadowOffsetY = W * 0.001;
    for (let i = this.notas.length - 1; i >= 0; i--) {
      const n = this.notas[i]; n.t += dt;
      if (n.t >= n.dur) { this.notas.splice(i, 1); continue; }
      const f = n.t / n.dur, [x0, y0] = this._p(n.e);
      const x = x0 + n.lado * W * (0.004 + 0.008 * f) + Math.sin(n.t * 3 + n.fase) * W * 0.003;
      const y = y0 - metro * (0.15 + 0.75 * f);
      O.globalAlpha = Math.min(1, f / 0.15) * Math.min(1, (1 - f) / 0.35);
      O.font = `600 ${Math.round(W * 0.02 * n.s)}px system-ui, "Segoe UI Symbol", "Noto Sans Symbols", sans-serif`;
      O.fillStyle = n.g === '♪' ? '#ffe2a8' : '#ffc878';
      O.fillText(n.g, x, y);
    }
    O.restore();
  }

  _flechas(punto) {  // ↑↓ que suben y bajan mientras el motor de la mesa consume
    const O = this.obj, [x, y] = this._p(punto), s = this.W * 0.009, d = Math.sin(this.t * 5) * s * 0.35;
    O.save(); O.fillStyle = '#fff'; O.strokeStyle = '#fff'; O.lineWidth = s * 0.28; O.lineCap = 'round';
    O.shadowColor = 'rgba(0,0,0,0.7)'; O.shadowBlur = s * 0.5;
    const flecha = (cx, cy, dir) => {
      O.beginPath(); O.moveTo(cx, cy + dir * s); O.lineTo(cx, cy - dir * s * 0.4); O.stroke();
      O.beginPath(); O.moveTo(cx, cy - dir * s); O.lineTo(cx - s * 0.5, cy - dir * s * 0.3); O.lineTo(cx + s * 0.5, cy - dir * s * 0.3); O.closePath(); O.fill();
    };
    flecha(x - s * 0.45, y - d, 1); flecha(x + s * 0.45, y + d, -1);
    O.restore();
  }

  _aire(a, k) {
    k = Math.max(k, 0.8);  // también de día
    const L = this.luz, O = this.obj, W = this.W;
    for (const [i, camino] of (a.flujo || []).entries()) {  // corrientes frías que salen del split y caen
      const pts = camino.map((p) => this._p(p)), fin = pts[pts.length - 1];
      const gr = L.createLinearGradient(...pts[0], ...fin);
      gr.addColorStop(0, `rgba(140,205,255,${0.85 * k})`); gr.addColorStop(1, 'rgba(140,205,255,0)');
      L.save(); L.strokeStyle = gr; L.lineWidth = W * 0.0028; L.lineCap = 'round';
      L.setLineDash([W * 0.018, W * 0.012]); L.lineDashOffset = -this.t * W * 0.05 - i * W * 0.007;
      L.beginPath(); L.moveTo(...pts[0]); for (const p of pts.slice(1)) L.lineTo(...p); L.stroke();
      L.setLineDash([]); L.globalAlpha = 0.25; L.lineWidth = W * 0.006; L.stroke(); L.restore();
    }
    if (a.cuerpo) {  // el split (en el modelo 3D no está)
      const pts = a.cuerpo.map((p) => this._p(p));
      O.save(); O.beginPath(); O.moveTo(...pts[0]); for (const p of pts.slice(1)) O.lineTo(...p); O.closePath();
      O.fillStyle = '#e8ebee'; O.strokeStyle = '#8e959c'; O.lineWidth = Math.max(1, W / 900);
      O.shadowColor = 'rgba(0,0,0,0.5)'; O.shadowBlur = W * 0.004; O.fill(); O.shadowBlur = 0; O.stroke();
      const [p0, p1, p2, p3] = pts, m = 0.3;  // rejilla de salida, abajo
      O.strokeStyle = '#5d646b'; O.beginPath();
      O.moveTo(p0[0] + (p3[0] - p0[0]) * m, p0[1] + (p3[1] - p0[1]) * m); O.lineTo(p1[0] + (p2[0] - p1[0]) * m, p1[1] + (p2[1] - p1[1]) * m);
      O.stroke(); O.restore();
    }
  }
}

/*
 * Energía: cuánto cuesta cada aparato con la tarifa de la luz.
 * Lo medido sale de las estadísticas de HA (sensores *_energia de las regletas); la tele se estima con las
 * horas que está encendida y los Echo con un consumo fijo; el «fondo sin medir» es lo que la casa gasta
 * siempre (base_w, de la curva horaria de la distribuidora) menos lo que ya se mide; el «resto sin medir»,
 * lo que falta para llegar al consumo de la factura (yearly_kwh) o del contador de la casa (total_energy).
 */
const HORA = 36e5, DIA = 864e5;

function navegar(url) {  // cambiar de página dentro de HA sin recargar
  const editar = /[?&]editar\b/.test(location.search) && !url.includes('?') ? '?editar' : '';
  history.pushState(null, '', url + editar);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}

class Energia {
  constructor(cfg, lista) {
    this.cfg = { price: 0.215, fixed_day: 0, base_w: 0, yearly_kwh: 0, ...cfg };
    this.lista = (lista || []).filter((a) => (a.potencia && a.potencia.length) || a.estimado_w);
  }

  static sensores(a) { return a.energia || (a.potencia || []).map((s) => s.replace(/_potencia$/, '_energia')); }
  static euros(x, dec) {
    const d = dec ?? (Math.abs(x) < 10 ? 2 : 0);
    return x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €';
  }
  static kwh(k) {
    const d = k < 1 ? 2 : k < 10 ? 1 : 0;
    return k.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }) + ' kWh';
  }

  ent(a) { const d = this.cfg.devices; return (d && d[a.id]) || a.estado || null; }
  medido(a) { return !!(a.potencia && a.potencia.length); }

  async cargar(hass) {
    this.hass = hass;
    const ahora = new Date(), hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
    const mes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ids = [...new Set(this.lista.flatMap((a) => (this.medido(a) ? Energia.sensores(a) : [])))];
    if (this.cfg.total_energy) ids.push(this.cfg.total_energy);
    const est = (desde, periodo) => (ids.length ? hass.callWS({ type: 'recorder/statistics_during_period', start_time: desde.toISOString(),
      statistic_ids: ids, period: periodo, types: ['change'] }) : Promise.resolve({}));
    const teles = this.lista.filter((a) => a.tipo === 'tele' && this.ent(a)).map((a) => this.ent(a));
    const desdeHist = new Date(Math.min(+mes, +hoy - 10 * DIA));
    const [horas, dias, hist] = await Promise.all([
      est(new Date(+hoy - 7 * DIA), 'hour'), est(new Date(+hoy - 366 * DIA), 'day'),
      teles.length ? hass.callWS({ type: 'history/history_during_period', start_time: desdeHist.toISOString(), entity_ids: teles,
        minimal_response: true, no_attributes: true }).catch(() => ({})) : Promise.resolve({})]);
    const lista = (r, id) => (r[id] || []).map((x) => ({ t: +new Date(typeof x.start === 'number' ? x.start : Date.parse(x.start)), c: x.change || 0 }));
    this.horas = {}; this.dias = {};
    for (const id of ids) { this.horas[id] = lista(horas, id); this.dias[id] = lista(dias, id); }
    this.hist = {};
    for (const [e, v] of Object.entries(hist || {})) {
      this.hist[e] = v.map((x) => ({ t: (x.lu ?? x.last_updated ?? x.last_changed) * (x.lu ? 1000 : 1), on: Energia._enciende(x.s ?? x.state) }));
      if (this.hist[e][0] && !Number.isFinite(this.hist[e][0].t)) this.hist[e][0].t = +desdeHist;
    }
    this.ultimaHora = Math.max(0, ...Object.values(this.horas).flat().map((x) => x.t + HORA));
    this.cargadoEn = Date.now();
  }

  static _enciende(s) { return !['off', 'standby', 'unavailable', 'unknown', undefined].includes(s); }

  // vatios ahora mismo (lo medido) y el estimado de lo que no se mide
  vatiosAhora(a) {
    const h = this.hass;
    if (this.medido(a)) return a.potencia.reduce((t, e) => { const v = h && h.states[e] ? parseFloat(h.states[e].state) : NaN; return t + (Number.isFinite(v) ? v : 0); }, 0);
    if (a.tipo === 'tele') { const s = h && h.states[this.ent(a)]; return s && Energia._enciende(s.state) ? a.estimado_w : 0; }
    return a.estimado_w || 0;
  }

  _sumar(serie, desde, hasta) { return (serie || []).reduce((t, x) => t + (x.t >= desde && x.t < hasta ? x.c : 0), 0); }

  // horas encendida de la tele entre dos instantes (según el historial de HA)
  _horasOn(e, desde, hasta) {
    const v = this.hist[e]; if (!v || !v.length) return null;
    let h = 0;
    for (let i = 0; i < v.length; i++) {
      if (!v[i].on) continue;
      const a = Math.max(v[i].t, desde), b = Math.min(i + 1 < v.length ? v[i + 1].t : Date.now(), hasta);
      if (b > a) h += (b - a) / HORA;
    }
    return h;
  }

  // kWh de un aparato entre dos instantes
  kwhAparato(a, desde, hasta, serie = 'auto') {
    if (this.medido(a)) {
      const usarHoras = serie === 'hora' || (serie === 'auto' && desde >= Date.now() - 7 * DIA);
      let t = 0;
      for (const id of Energia.sensores(a)) t += this._sumar(usarHoras ? this.horas[id] : this.dias[id], desde, hasta);
      if (hasta >= Date.now() - 60e3 && this.ultimaHora && serie !== 'dia') t += this.vatiosAhora(a) * Math.max(0, Date.now() - this.ultimaHora) / HORA / 1000;
      return t;
    }
    const horas = (hasta - desde) / HORA;
    if (a.tipo === 'tele') { const on = this._horasOn(this.ent(a), desde, hasta); return ((on ?? 0) * a.estimado_w) / 1000; }
    return (horas * (a.estimado_w || 0)) / 1000;
  }

  // kWh al año: media diaria de todo lo registrado × 365
  kwhAnual(a) {
    if (this.medido(a)) {
      let total = 0, primero = Infinity;
      for (const id of Energia.sensores(a)) { for (const x of this.dias[id] || []) { total += x.c; primero = Math.min(primero, x.t); } }
      const dias = (Date.now() - primero) / DIA;
      return dias > 0.25 ? (total / dias) * 365 : 0;
    }
    if (a.tipo === 'tele') {
      const v = this.hist[this.ent(a)]; if (!v || !v.length) return 0;
      const desde = v[0].t, dias = (Date.now() - desde) / DIA;
      return dias > 0.25 ? ((this._horasOn(this.ent(a), desde, Date.now()) * a.estimado_w) / 1000 / dias) * 365 : 0;
    }
    return (a.estimado_w || 0) * 8.76;
  }

  // lo que la casa gasta siempre y no se mide: base_w menos el mínimo de cada aparato medido y lo estimado fijo
  fondoW() {
    let medido = 0;
    for (const a of this.lista) {
      if (this.medido(a)) {
        const porHora = {};
        for (const id of Energia.sensores(a)) for (const x of this.horas[id] || []) porHora[x.t] = (porHora[x.t] || 0) + x.c;
        const v = Object.values(porHora);
        if (v.length) medido += Math.min(...v) * 1000;
      } else if (a.tipo !== 'tele') medido += a.estimado_w || 0;
    }
    return Math.max(0, this.cfg.base_w - medido);
  }

  // filas de un periodo: hoy | mes | anio
  resumen(vista) {
    const ahora = Date.now(), hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const desde = vista === 'hoy' ? +hoy : vista === 'mes' ? +new Date(hoy.getFullYear(), hoy.getMonth(), 1) : ahora - 365 * DIA;
    const horas = vista === 'anio' ? 8760 : (ahora - desde) / HORA;
    const P = this.cfg.price, fW = this.fondoW();
    const filas = this.lista.map((a) => {
      const k = vista === 'anio' ? this.kwhAnual(a) : this.kwhAparato(a, desde, ahora);
      const w = this.vatiosAhora(a);
      const sub = this.medido(a) ? 'medido' : a.tipo === 'tele' ? `estimado: ${a.estimado_w} W × horas encendida` : `estimado: ${a.estimado_w} W`;
      return { id: a.id, nombre: a.nombre, grupo: a.grupo, habitacion: a.habitacion, kwh: k, eur: k * P, sub, w, medido: this.medido(a), tele: a.tipo === 'tele' };
    });
    const zonas = {};  // por habitación (antes de juntar grupos, que pueden estar en sitios distintos)
    for (const f of filas) if (f.habitacion) { const z = zonas[f.habitacion] || (zonas[f.habitacion] = { kwh: 0, w: 0 }); z.kwh += f.kwh; z.w += f.w || 0; }
    const conocido = filas.reduce((t, f) => t + f.kwh, 0) + (fW * horas) / 1000;
    let totalKwh;
    if (this.cfg.total_energy && vista !== 'anio') totalKwh = this.kwhAparato({ potencia: ['x'], energia: [this.cfg.total_energy] }, desde, ahora);
    else totalKwh = (this.cfg.yearly_kwh / 8760) * horas;
    filas.push({ id: 'fondo', nombre: 'Fondo sin medir', sub: `nevera, router y esperas (~${Math.round(fW)} W siempre)`, kwh: (fW * horas) / 1000, sinMedir: true });
    filas.push({ id: 'resto', nombre: 'Resto sin medir', sub: vista === 'anio' ? 'cocina, lavadora, luces, horno…' : 'cocina, lavadora, luces… (estimado)',
      kwh: Math.max(0, totalKwh - conocido), sinMedir: true });
    // aparatos del mismo grupo (los dos monitores, los dos Echo) en una sola fila
    const juntas = [];
    for (const f of filas) {
      const g = f.grupo && juntas.find((x) => x.grupo === f.grupo);
      if (g) { g.kwh += f.kwh; g.w += f.w || 0; g.ids.push(f.id); } else juntas.push({ ...f, nombre: f.grupo || f.nombre, ids: [f.id] });
    }
    for (const f of juntas) {
      f.eur = f.kwh * P;
      if (f.medido) f.sub = `medido · ${Aparatos.vatios(f.w)} W ahora`;
      else if (f.tele && f.w) f.sub += ' · encendida ahora';
    }
    for (const z of Object.values(zonas)) z.eur = z.kwh * P;
    juntas.sort((a, b) => b.kwh - a.kwh);
    const kwh = Math.max(totalKwh, conocido);
    const fijo = this.cfg.fixed_day * (horas / 24);
    return { filas: juntas, zonas, kwh, energia: kwh * P, fijo, total: kwh * P + fijo, horas, fondoW: fW };
  }

  // barras del gráfico: [{etiqueta, partes: {id: kWh}, futuro}] (hoy: horas · mes: días)
  barras(vista) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fW = this.fondoW(), out = [];
    const tramo = (desde, hasta, etiqueta) => {
      const partes = {};
      if (desde < Date.now()) {
        const fin = Math.min(hasta, Date.now());
        for (const a of this.lista) partes[a.id] = this.kwhAparato(a, desde, fin, vista === 'hoy' ? 'hora' : 'dia');
        partes.fondo = (fW * (fin - desde)) / HORA / 1000;
      }
      out.push({ etiqueta, partes, futuro: desde >= Date.now() });
    };
    if (vista === 'hoy') for (let h = 0; h < 24; h++) tramo(+hoy + h * HORA, +hoy + (h + 1) * HORA, h % 3 ? '' : String(h).padStart(2, '0'));
    else {
      const n = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= n; d++) { const t = +new Date(hoy.getFullYear(), hoy.getMonth(), d); tramo(t, t + DIA, d === 1 || d % 5 === 0 ? String(d) : ''); }
    }
    return out;
  }

  // meses del año: facturas reales (bills) y el mes en curso
  meses() {
    const hoy = new Date(), out = [];
    const facturas = Object.fromEntries((this.cfg.bills || []).map((b) => [b.month, b]));
    const NOM = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const f = facturas[clave];
      if (f) out.push({ etiqueta: NOM[d.getMonth()], eur: f.eur, energia: f.kwh * this.cfg.price, real: true });
      else if (i === 0) { const r = this.resumen('mes'); out.push({ etiqueta: NOM[d.getMonth()], eur: r.total, energia: r.energia, enCurso: true }); }
      else out.push({ etiqueta: NOM[d.getMonth()], eur: 0, energia: 0 });
    }
    return out;
  }
}

const COLORES = { dock: '#ffb547', tele: '#7aa7ff', aire: '#7fd6ff', monitor_izquierdo: '#c79bff', monitor_derecho: '#a98bff',
  echo_dot: '#ff8fb1', echo_show: '#ff6f9a', sonos: '#c8e46a', mesa: '#9be3b4', fondo: '#8a8f98', resto: '#5d626b' };
const color = (id, i = 0) => COLORES[id] || ['#ffd27a', '#6fe0c8', '#f59f7a', '#b0c4ff'][i % 4];

/*
 * Página de energía (una vista aparte del panel):
 *   type: custom:home-energy-card
 *   path: /local/diorama/render/salida/
 *   back: /dashboard-diorama/casa     # botón «← Casa»
 *   kiosk: tablet                      # como en el diorama
 *   price: 0.215                       # €/kWh con impuestos
 *   fixed_day: 1.136                   # €/día fijo con impuestos (potencia, contador, bono social, seguro)
 *   yearly_kwh: 1970                   # consumo anual de la casa (facturas)
 *   base_w: 80                         # consumo de fondo de toda la casa (curva horaria de la distribuidora)
 *   tariff: Iberdrola Plan Estable · 2.0TD · 4,6 kW
 *   billed: { 2025: 602.53 }           # facturado por año (texto bajo el total)
 *   bills: [{ month: 2026-10, kwh: 183, eur: 75.12 }]
 *   savings: [{ text: Bajar la potencia a 3,5 kW, eur: -87 }]
 *   total_energy: sensor.casa_energia  # opcional: contador de toda la casa (sustituye a la estimación del resto)
 *   devices: { tele: media_player.television }
 * En el diorama, `energy: /dashboard-diorama/energia` añade la pastilla «⚡ … € hoy» que abre esta página.
 */
class HomeEnergyCard extends HTMLElement {
  setConfig(config) {
    if (!config.path) throw new Error('Falta "path" (carpeta con indice.json y aparatos.json)');
    this._config = { back: null, ...config };
    this._path = config.path.endsWith('/') ? config.path : config.path + '/';
    this._vista = this._vista || 'hoy';
    if (!this._root) this._montar();
    this._cargar();
  }

  getCardSize() { return 10; }

  set hass(hass) {
    const primera = !this._hass;
    this._hass = hass;
    this._kiosko();
    if (!this._modelo) return;
    this._modelo.hass = hass;
    if (primera || Date.now() - (this._modelo.cargadoEn || 0) > 5 * 60e3) this._actualizar();
    else if (Date.now() - (this._pintadoEn || 0) > 15e3) this._pintar();  // los vatios de ahora, sin volver a pedir datos
  }

  connectedCallback() { if (this._modelo && this._hass) this._actualizar(); }

  _montar() {
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>
      :host { display: block; --naranja: #ffb547; --txt: #f3f0ea; --suave: rgba(243,240,234,.58); --linea: rgba(255,255,255,.08); --tarjeta: rgba(255,255,255,.035); }
      ha-card { height: calc(100vh - var(--cabecera, 56px)); height: calc(100dvh - var(--cabecera, 56px)); overflow: hidden; position: relative; color: var(--txt);
                background: radial-gradient(1200px 700px at 20% 0%, #1a1d24, #0a0c10 70%); border: 0; border-radius: 0;
                font: 15px/1.35 var(--paper-font-body1_-_font-family, "Segoe UI", system-ui, sans-serif); touch-action: pan-y; user-select: none; }
      .pag { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(300px, 34%) 1fr; grid-template-rows: auto 1fr;
             gap: 1.6vh 1.4vw; padding: 2.4vh 2.2vw; }
      .sup { grid-column: 1 / 3; display: flex; align-items: center; gap: 18px; }
      .volver { background: var(--tarjeta); border: 1px solid var(--linea); border-radius: 999px; padding: 8px 16px 8px 12px; color: var(--txt); font: inherit; cursor: pointer; }
      .titulo { font-size: 24px; font-weight: 600; }
      .tabs { display: flex; gap: 6px; background: rgba(255,255,255,.06); border-radius: 999px; padding: 4px; margin: 0 auto; }
      .tabs button { padding: 7px 24px; border-radius: 999px; border: 0; background: none; color: var(--suave); font: inherit; cursor: pointer; }
      .tabs button.on { background: var(--naranja); color: #1b1206; font-weight: 600; }
      .tarifa { font-size: 13px; color: var(--suave); text-align: right; }
      .col { display: flex; flex-direction: column; gap: 1.6vh; min-height: 0; }
      .card { background: var(--tarjeta); border: 1px solid var(--linea); border-radius: 18px; padding: 2vh 1.5vw; position: relative; min-height: 0; }
      h1 { font-size: clamp(40px, 6.5vh, 70px); font-weight: 300; letter-spacing: -1px; line-height: 1; margin: 0; }
      h1 small { font-size: 18px; color: var(--suave); font-weight: 400; margin-left: 8px; letter-spacing: 0; }
      .sub { color: var(--suave); font-size: 13.5px; margin-top: 8px; }
      .stack { display: flex; height: 12px; border-radius: 6px; overflow: hidden; margin: 14px 0 6px; background: rgba(255,255,255,.05); }
      .leyenda { display: flex; justify-content: space-between; font-size: 13px; color: var(--suave); gap: 10px; }
      .leyenda b, .ahora b { color: var(--txt); }
      .ahora { font-size: 14px; color: var(--suave); margin-top: 10px; } .ahora b { color: var(--naranja); font-size: 18px; }
      h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--suave); font-weight: 600; margin: 0 0 1.2vh; }
      .mini { flex: 1; padding: 0; overflow: hidden; }
      .mini .marco { position: absolute; left: -25%; width: 136%; top: 50%; aspect-ratio: var(--ar); transform: translateY(-50%); }
      .mini img { position: absolute; inset: 0; width: 100%; height: 100%; filter: brightness(.5) saturate(.75); }
      .mini img.noche { filter: brightness(1.15); }
      .mini h2 { position: absolute; left: 16px; top: 12px; z-index: 1; }
      .tag { position: absolute; transform: translate(-50%,-50%); background: rgba(10,12,16,.82); border: 1px solid rgba(255,181,71,.55);
             border-radius: 12px; padding: 4px 9px; font-size: 13px; white-space: nowrap; }
      .tag b { color: var(--naranja); } .tag i { display: block; font-style: normal; font-size: 11px; color: var(--suave); }
      .ah { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: .7vh 0; border-bottom: 1px solid var(--linea); font-size: 14px; }
      .ah:last-child { border: 0; } .ah b { color: #8fe3a8; font-size: 16px; white-space: nowrap; }
      .graf { flex: 0 0 36%; display: flex; flex-direction: column; }
      .graf .ley { position: absolute; right: 1.5vw; top: 2vh; display: flex; gap: 14px; font-size: 12px; color: var(--suave); }
      .graf .ley i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
      .barras { flex: 1; display: flex; align-items: flex-end; gap: var(--hueco, 10px); border-bottom: 1px solid var(--linea); padding: 18px 2px 0; min-height: 0; }
      .barras .m { flex: 1; display: flex; flex-direction: column-reverse; position: relative; height: 100%; justify-content: flex-start; }
      .barras .m i { display: block; flex: none; } .barras .m i:last-child { border-radius: 4px 4px 0 0; }
      .barras .m .v { position: absolute; width: 100%; text-align: center; font-size: 11.5px; color: var(--suave); transform: translateY(-110%); }
      .barras .m.real .v { color: var(--txt); font-weight: 600; }
      .barras .m.fut { opacity: .15; } .barras .m.curso { opacity: .5; }
      .ejes { display: flex; gap: var(--hueco, 10px); padding: 5px 2px 0; } .ejes span { flex: 1; text-align: center; font-size: 12px; color: var(--suave); }
      .lista { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
      .cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 2.2vw; align-content: start; flex: 1; }
      .fila { display: grid; grid-template-columns: 16px 1fr auto 60px; align-items: center; gap: 2px 8px; padding: .55vh 0 .2vh; font-size: 14.5px; cursor: default; }
      .fila[data-info] { cursor: pointer; }
      .fila .p { width: 11px; height: 11px; border-radius: 3px; }
      .fila .n small { display: block; font-size: 11.5px; color: var(--suave); }
      .fila .k { text-align: right; color: var(--suave); font-size: 13px; } .fila .e { text-align: right; font-weight: 600; }
      .fila .b { grid-column: 2 / 5; height: 4px; border-radius: 2px; background: rgba(255,255,255,.05); }
      .fila .b i { display: block; height: 100%; border-radius: 2px; }
      .rayas { background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.32) 0 4px, rgba(255,255,255,.08) 4px 8px) !important; background-color: transparent !important; }
      .pie { font-size: 12px; color: var(--suave); margin-top: auto; padding-top: 8px; }
      .aviso { padding: 24px; color: var(--suave); }
      @media (max-width: 900px) {
        ha-card { height: auto; overflow: visible; } .pag { position: static; grid-template-columns: 1fr; }
        .sup { grid-column: 1; flex-wrap: wrap; } .tarifa { display: none; } .mini { min-height: 260px; } .graf { min-height: 260px; } .cols { grid-template-columns: 1fr; }
      }
    </style><ha-card><div class="aviso">Cargando la energía…</div></ha-card>`;
    this._card = this._root.querySelector('ha-card');
    let x0 = null, y0 = null;  // deslizar a izquierda/derecha cambia entre hoy, mes y año
    this._card.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
    this._card.addEventListener('pointerup', (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) this._mover(dx < 0 ? 1 : -1);
    });
  }

  _mover(paso) {
    const V = ['hoy', 'mes', 'anio'], i = V.indexOf(this._vista) + paso;
    if (i < 0 || i >= V.length) return;
    this._vista = V[i]; this._pintar();
  }

  async _cargar() {
    try {
      const [ri, ra] = await Promise.all([fetch(`${this._path}indice.json?v=${VERSION}`, { cache: 'no-cache' }),
        fetch(`${this._path}aparatos.json?v=${VERSION}`, { cache: 'no-cache' })]);
      this._indice = await ri.json();
      this._modelo = new Energia(this._config, (await ra.json()).aparatos || []);
    } catch (e) { this._card.innerHTML = `<div class="aviso">No encuentro ${this._path}indice.json o aparatos.json</div>`; return; }
    this._card.style.setProperty('--ar', (this._indice.resolucion[0] / this._indice.resolucion[1]).toFixed(4));
    const cab = this._config.header ?? 'var(--header-height, 56px)';
    this._card.style.setProperty('--cabecera', typeof cab === 'number' ? `${cab}px` : cab);
    this._kioskoAplicado = undefined;
    if (this._hass) this.hass = this._hass;
  }

  async _actualizar() {
    if (this._cargando) return;
    this._cargando = true;
    try { await this._modelo.cargar(this._hass); this._error = null; } catch (e) { this._error = e.message || String(e); }
    this._cargando = false;
    this._pintar();
  }

  _imagenFondo() {  // la del diorama: de día, la posición de sol más cercana; de noche, la de noche
    const s = this._hass.states['sun.sun'];
    const el = s ? Number(s.attributes.elevation) : 30, az = s ? Number(s.attributes.azimuth) : 210;
    if (el < 3 || !this._indice.sol || !this._indice.sol.length) return 'noche.jpg';
    const d = (p) => Math.hypot(((p.az - az + 540) % 360) - 180, p.el - el);
    return [...this._indice.sol].sort((p, q) => d(p) - d(q))[0].archivo;
  }

  _pintar() {
    if (!this._modelo || !this._modelo.cargadoEn) {
      if (this._error) this._card.innerHTML = `<div class="aviso">No puedo leer las estadísticas de energía: ${this._error}</div>`;
      return;
    }
    this._pintadoEn = Date.now();
    const M = this._modelo, C = this._config, v = this._vista, r = M.resumen(v);
    const E = Energia.euros, K = Energia.kwh, P = C.price ?? 0.215;
    const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const diasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    // --- total
    let cab, sub, ahora = '';
    if (v === 'hoy') {
      cab = `${E(r.total, 2)}<small>hoy, hasta las ${hora}</small>`;
      sub = `≈ ${K(r.kwh)} · media de tu casa: ${E(((C.yearly_kwh || 0) * P) / 365 + (C.fixed_day || 0), 2)}/día`;
    } else if (v === 'mes') {
      const prev = (r.total / r.horas) * 24 * diasMes;
      cab = `${E(r.total, 0)}<small>este mes · previsión ${E(prev, 0)}</small>`;
      sub = `≈ ${K(r.kwh)} en ${Math.ceil(r.horas / 24)} días`;
    } else {
      cab = `${E(r.total, 0)}<small>al año · ${E(r.total / 12, 0)}/mes</small>`;
      const fact = Object.entries(C.billed || {}).map(([a, e]) => `${a} → ${E(Number(e), 0)}`).join(' · ');
      sub = `${K(r.kwh)} al año · ${K(r.kwh / 365)} al día${fact ? `<br>Facturado: ${fact}` : ''}`;
    }
    const wMedidos = M.lista.reduce((t, a) => t + M.vatiosAhora(a), 0);
    if (v === 'hoy') ahora = `<div class="ahora">Ahora mismo: <b>${Math.round(wMedidos)} W</b> en lo medido + ~${Math.round(r.fondoW)} W de fondo</div>`;
    const total = `<div class="card"><h1>${cab}</h1><div class="sub">${sub}</div>
      <div class="stack"><i style="flex:${r.fijo};background:#3e4552"></i><i style="flex:${r.energia};background:var(--naranja)"></i></div>
      <div class="leyenda"><span><b>${E(r.fijo, v === 'hoy' ? 2 : 0)}</b> fijo: potencia, contador${C.fixed_day > 1.1 ? ', seguro' : ''}</span><span><b>${E(r.energia, v === 'hoy' ? 2 : 0)}</b> energía</span></div>${ahora}</div>`;
    // --- diorama pequeño con el coste por zona
    const tags = Object.entries(r.zonas).map(([h, z]) => {
      const hab = this._indice.habitaciones[h]; if (!hab) return '';
      const [u, vv] = hab.centro;
      const txt = v === 'hoy' ? `<b>${Math.round(z.w)} W</b><i>${hab.nombre.toLowerCase()} · ${E(z.eur, 2)} hoy</i>` : `<b>${E(z.eur)}</b><i>${hab.nombre.toLowerCase()}</i>`;
      return `<div class="tag" style="left:${u * 100}%;top:${vv * 100}%">${txt}</div>`;
    }).join('');
    const fondo = this._imagenFondo();
    const mini = `<div class="card mini"><h2>${v === 'hoy' ? 'Ahora por zona' : v === 'mes' ? 'Este mes por zona' : 'Al año por zona'}</h2>
      <div class="marco"><img src="${this._path}${fondo}" alt=""${fondo === 'noche.jpg' ? ' class="noche"' : ''}>${tags}</div></div>`;
    const ahorros = (C.savings || []).length ? `<div class="card"><h2>Dónde ahorrar</h2>${C.savings.map((s) =>
      `<div class="ah"><span>${s.text}</span><b>${s.eur < 0 ? '−' : ''}${Math.abs(s.eur)} €/año</b></div>`).join('')}</div>` : '';
    // --- gráfico
    const ids = M.lista.map((a) => a.id);
    let graf;
    if (v === 'anio') {
      const ms = M.meses(), max = Math.max(1, ...ms.map((m) => m.eur));
      graf = `<h2>Factura por mes</h2><div class="ley"><span><i style="background:#3e4552"></i>fijo</span><span><i style="background:var(--naranja)"></i>energía</span>
        <span>fuerte = factura · claro = mes en curso</span></div>
        <div class="barras">${ms.map((m) => `<div class="m${m.real ? ' real' : m.enCurso ? ' curso' : ''}">${m.eur ? `
          <i style="height:${((m.eur - m.energia) / max) * 88}%;background:#3e4552"></i><i style="height:${(m.energia / max) * 88}%;background:var(--naranja)"></i>
          <span class="v" style="bottom:${(m.eur / max) * 88}%">${Math.round(m.eur)} €</span>` : '<span class="v" style="bottom:0">—</span>'}</div>`).join('')}</div>
        <div class="ejes">${ms.map((m) => `<span>${m.etiqueta}</span>`).join('')}</div>`;
    } else {
      const bs = M.barras(v), orden = ['fondo', ...ids];
      const max = Math.max(0.05, ...bs.map((b) => Object.values(b.partes).reduce((t, x) => t + x, 0)));
      graf = `<h2>${v === 'hoy' ? 'Hora a hora · kWh' : 'Día a día · kWh'}</h2>
        <div class="ley"><span><i class="rayas"></i>fondo sin medir</span><span>el resto sin medir no sale aquí${C.total_energy ? '' : ' (no hay contador de la casa)'}</span></div>
        <div class="barras" style="--hueco:${v === 'hoy' ? 5 : 3}px">${bs.map((b) => `<div class="m${b.futuro ? ' fut' : ''}">${orden.map((id, i) =>
          `<i class="${id === 'fondo' ? 'rayas' : ''}" style="height:${((b.partes[id] || 0) / max) * 92}%;background:${color(id, i)}"></i>`).join('')}</div>`).join('')}</div>
        <div class="ejes" style="--hueco:${v === 'hoy' ? 5 : 3}px">${bs.map((b) => `<span>${b.etiqueta}</span>`).join('')}</div>`;
    }
    // --- lista de aparatos
    const mx = Math.max(0.001, ...r.filas.map((f) => f.kwh));
    const fila = (f, i) => { const a = f.ids && f.ids.length === 1 && M.lista.find((x) => x.id === f.id), info = a && (a.info || M.ent(a));
      return `<div class="fila"${info ? ` data-info="${info}"` : ''}><i class="p${f.sinMedir ? ' rayas' : ''}" style="background:${color(f.id, i)}"></i>
        <div class="n">${f.nombre}<small>${f.sub}</small></div><div class="k">${K(f.kwh)}</div><div class="e">${E(f.eur)}</div>
        <div class="b"><i class="${f.sinMedir ? 'rayas' : ''}" style="width:${Math.max(1, (f.kwh / mx) * 100)}%;background:${color(f.id, i)}"></i></div></div>`; };
    const mitad = Math.ceil(r.filas.length / 2);
    const titulo = { hoy: 'Hoy por aparato', mes: 'Este mes por aparato', anio: '¿En qué se va la energía? · al año' }[v];
    const lista = `<div class="card lista"><h2>${titulo}</h2><div class="cols"><div>${r.filas.slice(0, mitad).map(fila).join('')}</div>
      <div>${r.filas.slice(mitad).map((f, i) => fila(f, i + mitad)).join('')}</div></div>
      <div class="pie">${P.toLocaleString('es-ES')} €/kWh con impuestos · medido con las regletas · rayado = sin medir${v === 'anio' ? ' (factura menos lo medido)' : ''} · estimado mientras haya pocos días de datos</div></div>`;
    const tabs = ['hoy', 'mes', 'anio'].map((x) => `<button data-v="${x}" class="${x === v ? 'on' : ''}">${{ hoy: 'Hoy', mes: 'Mes', anio: 'Año' }[x]}</button>`).join('');
    this._card.innerHTML = `<div class="pag">
      <div class="sup">${C.back ? '<button class="volver">← Casa</button>' : ''}<div class="titulo">⚡ Energía</div><div class="tabs">${tabs}</div>
        <div class="tarifa">${C.tariff || ''}${C.tariff ? '<br>' : ''}${P.toLocaleString('es-ES')} €/kWh con impuestos</div></div>
      <div class="col">${total}${mini}${ahorros}</div>
      <div class="col"><div class="card graf">${graf}</div>${lista}</div></div>`;
    this._card.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { this._vista = b.dataset.v; this._pintar(); }));
    const volver = this._card.querySelector('.volver'); if (volver) volver.addEventListener('click', () => navegar(C.back));
    this._card.querySelectorAll('.fila[data-info]').forEach((f) => f.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: f.dataset.info }, bubbles: true, composed: true }))));
  }
}
HomeEnergyCard.prototype._kioskoActivo = Home3dCard.prototype._kioskoActivo;
HomeEnergyCard.prototype._kiosko = Home3dCard.prototype._kiosko;

customElements.define('home-3d-card', Home3dCard);
customElements.define('home-energy-card', HomeEnergyCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'home-3d-card', name: 'Home 3D (diorama)', description: 'Diorama de la casa con el sol y las luces reales' });
window.customCards.push({ type: 'home-energy-card', name: 'Energía de la casa', description: 'Coste de cada aparato con la tarifa de la luz' });
console.info(`%c home-3d-card ${VERSION} `, 'background:#ffc46b;color:#222;border-radius:3px');
