"""Busca ventanas en los muros exteriores: donde hay pared a 0.6-0.9 m (antepecho)
pero no a 1.4-1.9 m (el cristal no lo ve el LiDAR). Escribe 'ventanas' en layout.json."""
import sys, json, numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from scipy import ndimage
L = json.load(open(sys.argv[1])); G = np.load(sys.argv[2])
r = float(G['res']) * 100
lo = ndimage.maximum_filter(G['wall_lo'] > 0, 3); hi = ndimage.maximum_filter(G['wall_hi'] > 0, 3)
def at(g, x, y):
    i, j = int(x / r), int(y / r)
    return 0 <= i < g.shape[0] and 0 <= j < g.shape[1] and g[i, j]
polys = {k: Polygon(h['poligono']) for k, h in L['habitaciones'].items()}
casa = unary_union([p.buffer(25) for p in polys.values()]).buffer(-25)
vent = []
for k, p in polys.items():
    c = list(p.exterior.coords)
    for (x0, y0), (x1, y1) in zip(c[:-1], c[1:]):
        seg = LineString([(x0, y0), (x1, y1)]); n = int(seg.length // 4)
        if n < 10: continue
        dx, dy = (x1 - x0) / seg.length, (y1 - y0) / seg.length
        # normal hacia fuera de la habitación
        nx, ny = dy, -dx
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        if p.contains(Point(mx + nx * 5, my + ny * 5)): nx, ny = -nx, -ny
        # exterior si a 60 cm hacia fuera no hay otra habitación
        if any(q.contains(Point(mx + nx * 60, my + ny * 60)) for kk, q in polys.items() if kk != k): continue
        state = []
        for t in np.linspace(0, seg.length, n):
            px, py = x0 + dx * t, y0 + dy * t
            band = [(px + nx * d, py + ny * d) for d in range(-4, 30, 2)]
            l = any(at(lo, *b) for b in band); h = any(at(hi, *b) for b in band)
            state.append((t, l and not h))
        # tramos seguidos de "antepecho sin pared arriba" >= 45 cm
        run = None
        for t, w in state + [(seg.length + 1, False)]:
            if w and run is None: run = t
            if not w and run is not None:
                if t - run >= 45:
                    a, b = run, t
                    pa = (round(x0 + dx * a), round(y0 + dy * a)); pb = (round(x0 + dx * b), round(y0 + dy * b))
                    vent.append(dict(habitacion=k, x=[pa[0], pb[0]] if pa[0] != pb[0] else pa[0],
                                     y=[pa[1], pb[1]] if pa[1] != pb[1] else pa[1], ancho=round(b - a)))
                run = None
L['ventanas'] = vent
json.dump(L, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
for v in vent: print(v)
