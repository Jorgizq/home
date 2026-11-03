import sys, numpy as np, trimesh
m = trimesh.load(sys.argv[1], force='mesh', process=False)
v = m.vertices
print('verts', len(v), 'faces', len(m.faces))
for i,a in enumerate('xyz'):
    print(a, np.percentile(v[:,i],[0,1,5,50,95,99,100]).round(2))
# normals: which axis dominates up/down facing
n = m.face_normals; w = m.area_faces
for i,a in enumerate('xyz'):
    print('area with |n_%s|>0.9:'%a, round(w[np.abs(n[:,i])>0.9].sum(),1))
np.save(sys.argv[2], v); 
