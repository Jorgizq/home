"""Paso 1: del OBJ del escaneo (eje Y arriba, metros) a rejillas de planta.

Coordenadas de planta: X = x, Y = -z (vista desde arriba, sin espejo),
giradas para que las paredes queden a escuadra y con el origen en la
esquina inferior izquierda. Guarda un .npz con:
  wall   densidad de caras verticales entre 0.3 y 2.2 m
  wall_lo / wall_hi  idem a 0.6-0.9 m y 1.4-1.9 m (para ventanas)
  floor  área de suelo (caras horizontales a < 15 cm)
  tall   altura máxima de lo que hay en cada celda por debajo de 2.3 m
"""
import sys, numpy as np, trimesh
obj, out = sys.argv[1], sys.argv[2]
RES = 0.02
m = trimesh.load(obj, force='mesh', process=False)
n, a, c = m.face_normals, m.area_faces, m.triangles_center
floor = np.percentile(m.vertices[:, 1], 2)
P = np.c_[c[:, 0], -c[:, 2]]; N = np.c_[n[:, 0], -n[:, 2]]; h = c[:, 1] - floor
wall = np.abs(n[:, 1]) < 0.15
ang = np.arctan2(N[wall, 1], N[wall, 0]) % (np.pi / 2)
hist, e = np.histogram(ang, bins=360, weights=a[wall]); k = hist.argmax()
th = -(e[k] + e[k + 1]) / 2
th = (th + np.pi / 4) % (np.pi / 2) - np.pi / 4  # giro mínimo
R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
P = P @ R.T
sel_floor = (n[:, 1] > 0.9) & (h < 0.15)
core = P[sel_floor]
lo, hi = np.percentile(core, 0.5, axis=0) - 0.6, np.percentile(core, 99.5, axis=0) + 0.6
shape = tuple(np.ceil((hi - lo) / RES).astype(int))
def grid(mask, w=None):
    q = ((P[mask] - lo) / RES).astype(int)
    ok = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < shape[0]) & (q[:, 1] < shape[1])
    g = np.zeros(shape); np.add.at(g, (q[ok, 0], q[ok, 1]), (a[mask] if w is None else w)[ok]); return g
G = dict(
    wall=grid(wall & (h > .3) & (h < 2.2)),
    wall_lo=grid(wall & (h > .6) & (h < .9)),
    wall_hi=grid(wall & (h > 1.4) & (h < 1.9)),
    floor=grid(sel_floor),
)
q = ((P - lo) / RES).astype(int); ok = (q >= 0).all(1) & (q[:, 0] < shape[0]) & (q[:, 1] < shape[1]) & (h < 2.3) & (h > .15)
tall = np.zeros(shape); np.maximum.at(tall, (q[ok, 0], q[ok, 1]), h[ok]); G['tall'] = tall
np.savez_compressed(out, **G, res=RES, origin=lo, rot=th, floor_y=floor,
                    ceil=np.percentile(m.vertices[:, 1], 98) - floor)
print('giro', np.degrees(th), 'tamaño m', (hi - lo).round(2), 'techo', round(np.percentile(m.vertices[:, 1], 98) - floor, 2))
