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
 *   effects: true          # lluvia, nieve, nubes, niebla, tormenta y pájaros
 * Tocar la pastilla del tiempo (abajo a la izquierda) prueba los efectos aunque no esté lloviendo.
 */
const VERSION = '0.2.0';

class Home3dCard extends HTMLElement {
  setConfig(config) {
    if (!config.path) throw new Error('Falta "path" (carpeta con indice.json y las imágenes)');
    this._config = { sun: 'sun.sun', icons: true, rooms: true, effects: true, ...config };
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
      if (e.startsWith('weather.')) return `${s.state}|${s.attributes.temperature}|${s.attributes.wind_speed}|${s.attributes.wind_bearing}`;
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
        canvas.clima { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .destello { position: absolute; inset: 0; background: #dfe8ff; opacity: 0; pointer-events: none; mix-blend-mode: screen; }
        .tiempo { position: absolute; left: 2%; bottom: 3%; display: flex; align-items: center; gap: 8px; padding: 6px 12px;
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
    if (this._config.effects) {
      this._clima = new Clima(this._escena, this._indice);
      this._pastilla = document.createElement('button'); this._pastilla.className = 'tiempo';
      this._pastilla.addEventListener('click', (ev) => { ev.stopPropagation(); this._siguienteDemo(); });
    }
    this._luces = {};  // entidad → <img>, solo mientras está encendida (las imágenes ocultas también gastan memoria)
    if (this._config.rooms) this._montarZonas();
    if (this._config.icons) this._montarIconos();
    if (this._pastilla) this._escena.appendChild(this._pastilla);
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
    const t = this._entidadTiempo();
    return [this._config.sun, ...(t ? [t] : []), ...this._indice.luces.filter((l) => l.entidad).map((l) => l.entidad)];
  }

  _entidadTiempo() {
    if (this._config.weather) return this._config.weather;
    if (!this._hass) return null;
    return Object.keys(this._hass.states).find((e) => e.startsWith('weather.')) || null;
  }

  _alternar(entidad) {
    this._hass.callService('light', 'toggle', { entity_id: entidad });
  }

  _pintar() {
    this._pintarSol();
    this._pintarLuces();
    this._pintarTiempo();
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

  // ---------- tiempo ----------
  _siguienteDemo() {
    const orden = [null, 'rainy', 'lightning-rainy', 'snowy', 'fog', 'cloudy'];
    this._demo = orden[(orden.indexOf(this._demo ?? null) + 1) % orden.length];
    this._pintarTiempo();
  }

  _pintarTiempo() {
    if (!this._clima) return;
    const e = this._entidadTiempo(); const s = e && this._hass.states[e];
    const sol = this._hass.states[this._config.sun];
    const estado = this._demo || (s ? s.state : 'sunny');
    const a = s ? s.attributes : {};
    this._clima.poner({
      estado, viento: Number(a.wind_speed) || (this._demo ? 15 : 0), rumbo: Number(a.wind_bearing) || 250,
      dia: sol ? Number(sol.attributes.elevation) > 0 : true, mes: new Date().getMonth() + 1,
    });
    const ICONOS = { sunny: '☀️', 'clear-night': '🌙', partlycloudy: '⛅', cloudy: '☁️', rainy: '🌧️', pouring: '🌧️',
      'lightning-rainy': '⛈️', lightning: '🌩️', snowy: '❄️', 'snowy-rainy': '🌨️', fog: '🌫️', hail: '🌨️', windy: '💨', exceptional: '⚠️' };
    const NOMBRES = { sunny: 'Despejado', 'clear-night': 'Despejado', partlycloudy: 'Algo nuboso', cloudy: 'Nublado', rainy: 'Lluvia',
      pouring: 'Lluvia fuerte', 'lightning-rainy': 'Tormenta', lightning: 'Tormenta', snowy: 'Nieve', 'snowy-rainy': 'Aguanieve',
      fog: 'Niebla', hail: 'Granizo', windy: 'Viento', exceptional: 'Aviso' };
    const temp = a.temperature != null ? `${Math.round(a.temperature)}°` : '';
    this._pastilla.innerHTML = `<span class="icono-t">${ICONOS[estado] || '🌡️'}</span><span>${temp} ${NOMBRES[estado] || estado}</span>` +
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
    // viento: hacia dónde va (rumbo + 180), en la imagen; velocidad en km/h
    const hacia = ((t.rumbo + 180) * Math.PI) / 180, n = this.cam.norte, es = this.cam.este;
    const v = [Math.cos(hacia) * n[0] + Math.sin(hacia) * es[0], Math.cos(hacia) * n[1] + Math.sin(hacia) * es[1]];
    const m = Math.hypot(...v) || 1; this.viento = [v[0] / m, v[1] / m]; this.fuerza = Math.min(1, (t.viento || 0) / 40);
    this.estado = e;
    if (this.nubes.length === 0) for (let i = 0; i < 5; i++) this.nubes.push(this._nube(true));
    this._programarRayo(); this._programarPajaros(); this._arrancar();
  }

  _activo() {
    return !document.hidden && (this.lluvia || this.nieve || this.nubosidad || this.niebla || this.pajaros.length || this.charcos.length);
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

customElements.define('home-3d-card', Home3dCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'home-3d-card', name: 'Home 3D (diorama)', description: 'Diorama de la casa con el sol y las luces reales' });
console.info(`%c home-3d-card ${VERSION} `, 'background:#ffc46b;color:#222;border-radius:3px');
