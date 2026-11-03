"""Mapa numerado de los puntos de luz (casa/luces.json) sobre la vista cenital del escaneo."""
import sys, json, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from PIL import Image
img = np.asarray(Image.open(sys.argv[1])); h, w = img.shape[:2]
Lz = json.load(open(sys.argv[2]))['luces']; L = json.load(open(sys.argv[3]))
fig, ax = plt.subplots(figsize=(w / 85, h / 85))
ax.imshow(img, extent=[0, w, 0, h], alpha=.55)
for k, hb in L['habitaciones'].items():
    p = np.array(hb['poligono']); ax.plot(*np.vstack([p, p[:1]]).T, color='black', lw=.8, alpha=.7)
col = {'techo': '#f5b301', 'colgante': '#ff7a00', 'mesa': '#e04f9a', 'foco': '#2f9be8', 'aplique': '#7b5cd6'}
for l in Lz:
    c = col.get(l['tipo'], 'red') if l.get('entidad') else '#8a8a8a'
    for px, py in l.get('puntos', []): ax.plot(px, py, 'o', ms=6, color=c, mec='white', mew=1)
    ax.text(l['x'], l['y'], str(l['n']), ha='center', va='center', fontsize=12, weight='bold', color='white',
            bbox=dict(boxstyle='circle,pad=0.25', fc=c, ec='black' if l.get('seguro', True) is False else 'white', lw=2.5 if l.get('seguro', True) is False else 1.5,
                      ls='--' if l.get('seguro', True) is False else '-'))
for t, c in col.items(): ax.plot([], [], 'o', color=c, label=t)
ax.plot([], [], 'o', color='#8a8a8a', label='sin Home Assistant')
ax.legend(loc='lower right', fontsize=11); ax.set_xticks([]); ax.set_yticks([])
ax.set_title('Puntos de luz · borde negro = por confirmar', fontsize=14)
txt = '\n'.join(f"{l['n']:>2}  {l['entidad'] or '— ' + l['nombre']}" for l in Lz)
ax.text(15, 470, txt, ha='left', va='top', family='monospace', fontsize=9, bbox=dict(fc='white', alpha=.9))
plt.tight_layout(); plt.savefig(sys.argv[4], dpi=85)
