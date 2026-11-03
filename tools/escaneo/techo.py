"""Techo del escaneo visto desde abajo (en planta, mismas coordenadas que layout.json)
y lo que cuelga de él (lámparas, ventiladores). Uso:
  python techo.py escaneo.obj textura.jpg rejillas.npz salida.png [layout.json]"""
import sys, json, numpy as np, trimesh
from PIL import Image
from scipy import ndimage
Image.MAX_IMAGE_PIXELS = None
obj, tex, npz, out = sys.argv[1:5]
G = np.load(npz); th = float(G['rot']); lo = G['origin']; floor = float(G['floor_y'])
m = trimesh.load(obj, force='mesh', process=False); uv, F, V = m.visual.uv, m.faces, m.vertices
T = np.asarray(Image.open(tex).convert('RGB')); TH, TW = T.shape[:2]
R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
res = 0.01; w, h = (np.array(G['wall'].shape) * float(G['res']) / res).astype(int)
img = np.full((h, w, 3), 30, np.uint8); zb = np.full((h, w), 9.0)
colg = np.zeros((h, w), bool)
for b in np.array([[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]):
    p = (V[F] * b[None, :, None]).sum(1); u = (uv[F] * b[None, :, None]).sum(1)
    hh = p[:, 1] - floor; k = hh > 1.75; p, u, hh = p[k], u[k], hh[k]
    xy = np.c_[p[:, 0], -p[:, 2]] @ R.T - lo
    ix = (xy[:, 0] / res).astype(int); iy = h - 1 - (xy[:, 1] / res).astype(int)
    ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h); ix, iy, hh, u = ix[ok], iy[ok], hh[ok], u[ok]
    tx = np.clip((u[:, 0] % 1) * TW, 0, TW - 1).astype(int); ty = np.clip((1 - u[:, 1] % 1) * TH, 0, TH - 1).astype(int)
    o = np.argsort(-hh)  # visto desde abajo: lo más bajo encima
    img[iy[o], ix[o]] = T[ty[o], tx[o]]
    zb[iy, ix] = np.minimum.at(zb, (iy, ix), hh) if False else zb[iy, ix]
    np.minimum.at(zb, (iy, ix), hh)
# lo que cuelga: entre 1.75 y 2.55 m, lejos de las paredes
techo = np.percentile(zb[zb < 9], 70)
colg = (zb < techo - 0.25) & (zb > 1.75)
colg = ndimage.binary_opening(colg, np.ones((3, 3)))
hole = (img == 30).all(2)
for _ in range(3):
    for c in range(3):
        img[..., c] = np.where(hole, ndimage.grey_dilation(np.where(hole, 0, img[..., c]), size=3), img[..., c])
    hole = (img == 0).all(2); img[hole] = 30; hole = (img == 30).all(2)
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(w / 100, h / 100))
ax.imshow(img, extent=[0, w, 0, h])
ax.contour(np.flipud(colg).astype(float), levels=[0.5], colors='cyan', linewidths=1.2, extent=[0, w, 0, h], origin='lower')
if len(sys.argv) > 5:
    from shapely.geometry import Polygon as Poly
    L = json.load(open(sys.argv[5]))
    for k, hb in L['habitaciones'].items():
        p = np.array(hb['poligono']); ax.plot(*np.vstack([p, p[:1]]).T, color='white', lw=.6, alpha=.6)
ax.set_xticks(np.arange(0, w, 100)); ax.set_yticks(np.arange(0, h, 100)); ax.grid(alpha=.2)
ax.set_title('Techo visto desde abajo (cian: lo que cuelga: lámparas, ventiladores)')
plt.tight_layout(); plt.savefig(out, dpi=100)
print('techo a', round(techo, 2), 'm')
