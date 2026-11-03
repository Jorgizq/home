import sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from PIL import Image
img = np.asarray(Image.open(sys.argv[1])); x0,x1,y0,y1 = -5.3647,3.8844,-7.1666,8.3349
pts = {1:(-4.2,-2.6),2:(-0.6,-2.6),3:(2.5,-3.0),4:(-2.8,-4.8),5:(0.5,0.4),6:(-4.4,2.4),
       7:(-1.2,3.0),8:(0.35,2.7),9:(1.1,2.9),10:(0.3,4.4),11:(0.5,5.9),12:(1.0,7.6),13:(2.7,4.4),14:(2.1,6.5)}
fig, ax = plt.subplots(figsize=(9,14))
ax.imshow(img, extent=[x0,x1,y0,y1])
for k,(x,y) in pts.items():
    ax.text(x,y,str(k),fontsize=16,weight='bold',color='white',ha='center',va='center',
            bbox=dict(boxstyle='circle',fc='#c0392b',ec='white'))
ax.set_xticks(range(-5,5)); ax.set_yticks(range(-7,9)); ax.grid(alpha=.25)
ax.set_title('Escaneo visto desde arriba, cortado a 1,3 m (metros)')
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=90)
