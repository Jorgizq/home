"""Vista cenital a color del escaneo, cortada a CUT m (como una maqueta sin techo),
en las mismas coordenadas que layout.json (cm). Uso:
  python vista_cenital.py escaneo.obj textura.jpg rejillas.npz salida.png [CUT] [layout.json]"""
import sys, json, numpy as np, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
obj, tex, npz, out = sys.argv[1:5]; CUT = float(sys.argv[5]) if len(sys.argv) > 5 else 1.3
G = np.load(npz); th = float(G['rot']); lo = G['origin']; floor = float(G['floor_y'])
m = trimesh.load(obj, force='mesh', process=False)
uv, F, V = m.visual.uv, m.faces, m.vertices
T = np.asarray(Image.open(tex).convert('RGB')); TH, TW = T.shape[:2]
R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
res = 0.01; pts = []; hs = []; cols = []
for b in np.array([[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]):
    p = (V[F] * b[None, :, None]).sum(1); u = (uv[F] * b[None, :, None]).sum(1)
    k = p[:, 1] < floor + CUT; p, u = p[k], u[k]
    xy = np.c_[p[:, 0], -p[:, 2]] @ R.T - lo
    tx = np.clip((u[:, 0] % 1) * TW, 0, TW - 1).astype(int); ty = np.clip((1 - u[:, 1] % 1) * TH, 0, TH - 1).astype(int)
    pts.append(xy); hs.append(p[:, 1]); cols.append(T[ty, tx])
P = np.vstack(pts); H = np.concatenate(hs); C = np.vstack(cols)
w, h = (np.array(G['wall'].shape) * float(G['res']) / res).astype(int)
ix = (P[:, 0] / res).astype(int); iy = h - 1 - (P[:, 1] / res).astype(int)
ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h); o = np.argsort(H[ok])
img = np.full((h, w, 3), 30, np.uint8); img[iy[ok][o], ix[ok][o]] = C[ok][o]
from scipy import ndimage
hole = (img == 30).all(2)  # rellena huecos pequeños con el color vecino
for _ in range(3):
    for c in range(3):
        img[..., c] = np.where(hole, ndimage.grey_dilation(np.where(hole, 0, img[..., c]), size=3), img[..., c])
    hole = (img == 0).all(2); img[hole] = 30; hole = (img == 30).all(2)
if len(sys.argv) > 6:
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    from shapely.geometry import Polygon as Poly
    L = json.load(open(sys.argv[6])); fig, ax = plt.subplots(figsize=(w / 100, h / 100))
    ax.imshow(img, extent=[0, w, 0, h])
    for k, hb in L['habitaciones'].items():
        rp = Poly(hb['poligono']).representative_point()
        ax.text(rp.x, rp.y, hb['nombre'], color='white', fontsize=11, weight='bold', ha='center',
                bbox=dict(fc='black', alpha=.5, ec='none'))
    ax.axis('off'); plt.tight_layout(pad=0); plt.savefig(out, dpi=100)
else:
    Image.fromarray(img).save(out)
