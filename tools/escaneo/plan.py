import sys, numpy as np, trimesh, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
m = trimesh.load(sys.argv[1], force='mesh', process=False)
out = sys.argv[2]
V = m.vertices.copy()
# Y-up -> (X, Z) plan, height Y
n = m.face_normals; a = m.area_faces; c = m.triangles_center
floor = np.percentile(V[:,1], 2); ceil = np.percentile(V[:,1], 98)
print('floor', floor, 'ceil', ceil)
# dominant wall direction from horizontal normals (mod 90)
wall = np.abs(n[:,1]) < 0.15
ang = np.arctan2(n[wall,2], n[wall,0]) % (np.pi/2)
h, e = np.histogram(ang, bins=180, weights=a[wall])
k = np.argmax(h); th = (e[k]+e[k+1])/2
print('rot deg', np.degrees(th))
R = np.array([[np.cos(-th), -np.sin(-th)],[np.sin(-th), np.cos(-th)]])
def rot(xz): return xz @ R.T
np.save(out+'_rot.npy', np.array([th, floor, ceil]))
# wall density map: wall faces between 0.4 and 2.0 m above floor
sel = wall & (c[:,1] > floor+0.4) & (c[:,1] < floor+2.0)
P = rot(c[sel][:,[0,2]]); W = a[sel]
res = 0.02
x0,y0 = P.min(0)-0.2; x1,y1 = P.max(0)+0.2
H, xe, ye = np.histogram2d(P[:,0], P[:,1], bins=[int((x1-x0)/res), int((y1-y0)/res)], range=[[x0,x1],[y0,y1]], weights=W)
np.save(out+'_density.npy', H); np.save(out+'_extent.npy', np.array([x0,x1,y0,y1]))
fig, ax = plt.subplots(1,2, figsize=(20,12))
ax[0].imshow(np.sqrt(H.T), origin='lower', extent=[x0,x1,y0,y1], cmap='gray_r', vmax=np.percentile(np.sqrt(H[H>0]),95))
ax[0].set_title('Paredes (densidad 0.4-2.0 m)'); ax[0].grid(alpha=.3); ax[0].set_aspect('equal')
# section at 1.0m
for hh,col in [(1.0,'k'),(1.6,'tab:red')]:
    s = m.section(plane_origin=[0,floor+hh,0], plane_normal=[0,1,0])
    if s is None: continue
    for ent in [s.vertices[e.points] for e in s.entities]:
        p = rot(ent[:,[0,2]]); ax[1].plot(p[:,0], p[:,1], col, lw=.5)
ax[1].set_title('Corte a 1.0 m (negro) y 1.6 m (rojo)'); ax[1].set_aspect('equal'); ax[1].grid(alpha=.3)
ax[1].set_xlim(x0,x1); ax[1].set_ylim(y0,y1)
plt.tight_layout(); plt.savefig(out+'.png', dpi=80)
