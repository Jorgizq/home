"""Proyecta casa/aparatos.json a la imagen → render/salida/aparatos.json (lo lee la tarjeta).

No necesita Blender: recupera la cámara (matriz 3x4, DLT) a partir de los iconos de luz de
render/salida/indice.json, que renderizar.py proyectó con la cámara real a una altura conocida
(focos/techo/colgantes a 1 m; el resto a su z, como mucho 1,20 m).

    python tools/aparatos.py            # desde la raíz del repo
"""
import json
import math
import os
import sys

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORTE = 138  # cm: los muros se cortan a 140; nada se dibuja por encima


def cargar(ruta):
    with open(os.path.join(RAIZ, ruta), encoding='utf-8') as f:
        return json.load(f)


def camara(indice, luces):
    por_n = {l['n']: l for l in (luces['luces'] if isinstance(luces, dict) else luces)}
    A = []
    for l in indice['luces']:
        p = por_n.get(l['n'])
        if not p or not l.get('icono'):
            continue
        z = 100 if p['tipo'] in ('foco', 'techo', 'colgante') else min(p.get('z', 90), 120)
        X = [p['x'], p['y'], z, 1]
        u, v = l['icono']
        A.append([*X, 0, 0, 0, 0, *[-u * c for c in X]])
        A.append([0, 0, 0, 0, *X, *[-v * c for c in X]])
    P = np.linalg.svd(np.array(A, float))[2][-1].reshape(3, 4)
    err = []
    for l in indice['luces']:
        p = por_n.get(l['n'])
        if p and l.get('icono'):
            z = 100 if p['tipo'] in ('foco', 'techo', 'colgante') else min(p.get('z', 90), 120)
            q = P @ [p['x'], p['y'], z, 1]
            err.append(math.hypot((q[0] / q[2] - l['icono'][0]) * indice['resolucion'][0],
                                  (q[1] / q[2] - l['icono'][1]) * indice['resolucion'][1]))
    return P, float(np.median(err)), float(max(err))


def main():
    indice = cargar('render/salida/indice.json')
    P, mediana, peor = camara(indice, cargar('casa/luces.json'))

    def pr(x, y, z):
        q = P @ [x, y, min(z, CORTE), 1]
        return [round(float(q[0] / q[2]), 4), round(float(q[1] / q[2]), 4)]

    def cara(c):  # rectángulo vertical en un plano x = cte (o y = cte)
        z0, z1 = c['z']
        if 'x' in c and isinstance(c['y'], list):
            (a, b), x = c['y'], c['x']
            return [pr(x, a, z0), pr(x, b, z0), pr(x, b, z1), pr(x, a, z1)]
        (a, b), y = c['x'], c['y']
        return [pr(a, y, z0), pr(b, y, z0), pr(b, y, z1), pr(a, y, z1)]

    def mancha(b):  # círculo horizontal → centro y semiejes en la imagen (0..1)
        pts = [pr(b['x'] + b['r'] * math.cos(t), b['y'] + b['r'] * math.sin(t), b['z'])
               for t in np.linspace(0, 2 * math.pi, 24, endpoint=False)]
        us, vs = [p[0] for p in pts], [p[1] for p in pts]
        return {'c': pr(b['x'], b['y'], b['z']), 'rx': round((max(us) - min(us)) / 2, 4), 'ry': round((max(vs) - min(vs)) / 2, 4)}

    salida = []
    for a in cargar('casa/aparatos.json')['aparatos']:
        o = {k: a[k] for k in ('id', 'nombre', 'tipo', 'habitacion', 'estado', 'potencia', 'umbral', 'info') if a.get(k) is not None}
        if 'pantalla' in a: o['pantalla'] = cara(a['pantalla'])
        if 'cuerpo' in a: o['cuerpo'] = cara(a['cuerpo'])
        if 'brillo' in a: o['brillo'] = mancha(a['brillo'])
        if 'punto' in a: o['punto'] = pr(**a['punto'])
        if 'emisores' in a: o['emisores'] = [pr(**e) for e in a['emisores']]
        if 'flujo' in a:  # corrientes de aire: salen hacia delante y caen
            f = a['flujo']; (x0, x1), (z0, z1) = f['x'], f['z']
            o['flujo'] = [[pr(x0 + (x1 - x0) * t, y + 10 * math.sin(t * 5 + k), z0 + (z1 - z0) * t ** 1.6)
                           for t in np.linspace(0, 1, 20)] for k, y in enumerate(f['y'])]
        salida.append(o)

    ruta = os.path.join(RAIZ, 'render/salida/aparatos.json')
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump({'aparatos': salida}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(salida)} aparatos -> {ruta}  (cámara: error mediano {mediana:.1f} px, peor {peor:.1f} px)')
    if mediana > 3:
        sys.exit('La cámara no encaja con los iconos: revisar luces.json / indice.json')


if __name__ == '__main__':
    main()
