"""Dibuja layout.json sobre el escaneo para revisarlo."""
import sys, json, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle
from shapely.geometry import Polygon as Poly
L = json.load(open(sys.argv[1])); G = np.load(sys.argv[2]); out = sys.argv[3]
r = float(G['res']); W = G['wall']; sh = W.shape; ext = [0, sh[0]*r*100, 0, sh[1]*r*100]
fig, ax = plt.subplots(figsize=(11, 16))
v = np.sqrt(W); ax.imshow(np.ma.masked_less(v, 1e-4).T, origin='lower', extent=ext, cmap='gray_r',
                          vmax=np.percentile(v[v > 0], 95), alpha=.55)
cols = plt.cm.tab20.colors
for i, (k, h) in enumerate(L['habitaciones'].items()):
    p = np.array(h['poligono']); ax.add_patch(Polygon(p, fc=cols[i % 20], ec='k', alpha=.35, lw=1.5))
    rp = Poly(p).representative_point(); ax.text(rp.x, rp.y, h['nombre'], ha='center', va='center', fontsize=10, weight='bold')
for a in L['aberturas']:
    x, y = a['x'], a['y']
    xs = x if isinstance(x, list) else [x, x]; ys = y if isinstance(y, list) else [y, y]
    c = {'puerta': 'tab:red', 'hueco': 'tab:green', 'abierto': 'tab:green'}.get(a['tipo'], 'tab:purple')
    ax.plot(xs, ys, color=c, lw=6, alpha=.9, solid_capstyle='butt',
            ls='-' if a.get('seguro', True) else (0, (2, 1)))
for mb in L.get('muebles', []):
    (x0, y0), (x1, y1) = mb['caja']; ax.add_patch(Rectangle((x0, y0), x1-x0, y1-y0, fc='none', ec='tab:brown', lw=2, hatch='//'))
for w in L.get('ventanas', []):
    xs = w['x'] if isinstance(w['x'], list) else [w['x']]*2; ys = w['y'] if isinstance(w['y'], list) else [w['y']]*2
    ax.plot(xs, ys, color='tab:blue', lw=7, solid_capstyle='butt', ls='-' if w.get('seguro', True) else (0, (2, 1)))
ax.set_xlim(-30, ext[1]); ax.set_ylim(-30, ext[3]); ax.set_aspect('equal')
ax.set_xticks(np.arange(0, ext[1], 100)); ax.set_yticks(np.arange(0, ext[3], 100)); ax.grid(alpha=.25)
ax.set_title('Borrador del plano (cm). Rojo: puertas · Verde: huecos · Azul: ventanas · Discontinuo: por confirmar')
plt.tight_layout(); plt.savefig(out, dpi=70)
