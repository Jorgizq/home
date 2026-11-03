"""Paso 2: detecta caras de pared rectas (horizontales y verticales) en la rejilla."""
import sys, json, numpy as np
from scipy import ndimage
G = np.load(sys.argv[1]); r = float(G['res']); W = G['wall']
thr = np.percentile(W[W > 0], 60)
B = W > thr
MINLEN = float(sys.argv[3]) if len(sys.argv) > 3 else 0.4
def runs(row, gap):
    row = ndimage.binary_closing(row, structure=np.ones(gap))
    lab, n = ndimage.label(row)
    return [(s[0].start, s[0].stop) for s in ndimage.find_objects(lab)]
def extract(B):  # lines along axis 0 (x), indexed by axis 1 (y)
    segs = []
    for j in range(B.shape[1]):
        for a, b in runs(B[:, j], 6):
            if (b - a) * r >= MINLEN: segs.append([j, a, b])
    # merge segments in neighbouring rows that overlap
    segs.sort(); out = []
    for j, a, b in segs:
        for o in out:
            if j - o['j1'] <= 2 and min(b, o['b']) - max(a, o['a']) > 0.5 * min(b - a, o['b'] - o['a']):
                o['js'].append(j); o['j1'] = j; o['a'] = min(a, o['a']); o['b'] = max(b, o['b']); break
        else: out.append(dict(js=[j], j1=j, a=a, b=b))
    res = []
    for o in out:
        pos = (np.mean(o['js']) + .5) * r
        res.append(dict(pos=round(pos, 2), desde=round(o['a'] * r, 2), hasta=round(o['b'] * r, 2), filas=len(o['js'])))
    return sorted(res, key=lambda d: (d['pos'], d['desde']))
L = dict(horizontales=extract(B), verticales=extract(B.T))
json.dump(L, open(sys.argv[2], 'w'), indent=1)
for k, v in L.items():
    print(k)
    for d in v:
        if d['hasta'] - d['desde'] >= MINLEN: print('  %5.2f  %5.2f→%5.2f' % (d['pos'], d['desde'], d['hasta']))
