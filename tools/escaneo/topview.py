# Vista cenital a color, cortada a CUT m sobre el suelo (como una maqueta sin techo)
import sys, numpy as np, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
obj, tex, out = sys.argv[1:4]; CUT = float(sys.argv[4]) if len(sys.argv)>4 else 1.3
m = trimesh.load(obj, force='mesh', process=False)
th, floor, ceil = np.load(out.replace('_top.png','_rot.npy')) if False else (np.radians(24.2497), -0.05086, 2.826)
uv = m.visual.uv; F = m.faces; V = m.vertices
T = np.asarray(Image.open(tex).convert('RGB')); th_, tw = T.shape[:2]
# sample several points per face (barycentric) for coverage
bary = np.array([[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]])
R = np.array([[np.cos(-th), -np.sin(-th)],[np.sin(-th), np.cos(-th)]])
res = 0.01
pts=[];hs=[];cols=[]
for b in bary:
    p = (V[F]*b[None,:,None]).sum(1); u = (uv[F]*b[None,:,None]).sum(1)
    keep = p[:,1] < floor + CUT
    p=p[keep]; u=u[keep]
    xy = p[:,[0,2]] @ R.T
    tx = np.clip((u[:,0]%1)*tw,0,tw-1).astype(int); ty = np.clip((1-u[:,1]%1)*th_,0,th_-1).astype(int)
    pts.append(xy); hs.append(p[:,1]); cols.append(T[ty,tx])
P=np.vstack(pts); H=np.concatenate(hs); C=np.vstack(cols)
x0,y0 = P.min(0); x1,y1 = P.max(0)
W=int((x1-x0)/res)+1; Hh=int((y1-y0)/res)+1
ix=((P[:,0]-x0)/res).astype(int); iy=((y1-P[:,1])/res).astype(int)
o=np.argsort(H)  # higher overwrites lower
img=np.full((Hh,W,3),255,np.uint8); img[iy[o],ix[o]]=C[o]
# fill 1-px holes
from scipy import ndimage
mask=(img==255).all(2)
for _ in range(2):
    for ch in range(3):
        f=ndimage.grey_dilation(np.where(mask,0,img[...,ch]),size=3)
        img[...,ch]=np.where(mask,f,img[...,ch])
    mask=(img==255).all(2)|(img==0).all(2)
Image.fromarray(img).save(out)
print(img.shape, 'extent', x0,x1,y0,y1)
