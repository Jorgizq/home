"""Alzado (vista de frente) de una pared del escaneo, a color.
Uso: python alzado.py escaneo.obj textura.jpg rejillas.npz salida.png x0 y0 x1 y1 [banda_cm]
La pared va de (x0,y0) a (x1,y1) en cm (coordenadas de layout.json); se mira desde
la izquierda del sentido de avance. Se pintan las superficies a ±banda de la línea."""
import sys, numpy as np, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
obj, tex, npz, out = sys.argv[1:5]; x0, y0, x1, y1 = map(float, sys.argv[5:9])
band = float(sys.argv[9]) if len(sys.argv) > 9 else 40
G = np.load(npz); th = float(G['rot']); lo = G['origin'] * 100; floor = float(G['floor_y'])
m = trimesh.load(obj, force='mesh', process=False); uv, F, V = m.visual.uv, m.faces, m.vertices
T = np.asarray(Image.open(tex).convert('RGB')); TH, TW = T.shape[:2]
R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
d = np.array([x1 - x0, y1 - y0]); Lg = np.linalg.norm(d); d /= Lg; nrm = np.array([-d[1], d[0]])  # hacia el observador
res = 1.0; pts = []
for b in np.array([[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]):
    p = (V[F] * b[None, :, None]).sum(1); u = (uv[F] * b[None, :, None]).sum(1)
    xy = (np.c_[p[:, 0], -p[:, 2]] @ R.T) * 100 - lo
    rel = xy - [x0, y0]; t = rel @ d; s = rel @ nrm; h = (p[:, 1] - floor) * 100
    k = (t >= 0) & (t <= Lg) & (np.abs(s) < band) & (h > -5) & (h < 300)
    tx = np.clip((u[k, 0] % 1) * TW, 0, TW - 1).astype(int); ty = np.clip((1 - u[k, 1] % 1) * TH, 0, TH - 1).astype(int)
    pts.append((t[k], h[k], s[k], T[ty, tx]))
t = np.concatenate([q[0] for q in pts]); h = np.concatenate([q[1] for q in pts])
s = np.concatenate([q[2] for q in pts]); C = np.vstack([q[3] for q in pts])
W, H = int(Lg / res) + 1, 301
img = np.full((H, W, 3), 30, np.uint8); o = np.argsort(-s)  # lo más cercano al observador encima
ix = (t / res).astype(int); iy = (H - 1 - np.clip(h, 0, 300) / res).astype(int)
img[iy[o[::-1]], ix[o[::-1]]] = C[o[::-1]]
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(max(6, W / 60), 5.5))
ax.imshow(img, extent=[0, Lg, 0, 300]); ax.set_xlabel(f'cm a lo largo de la pared desde ({x0:.0f},{y0:.0f})')
ax.set_ylabel('altura (cm)'); ax.set_xticks(np.arange(0, Lg, 50)); ax.set_yticks(np.arange(0, 301, 50)); ax.grid(alpha=.3)
plt.tight_layout(); plt.savefig(out, dpi=80)
