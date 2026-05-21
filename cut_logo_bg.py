"""Strip the pure-black background from brand-logo.png so the gold mark
is left as a true alpha-cutout PNG.

Algorithm:
  alpha   = max(R, G, B)     # luminance-derived transparency
  RGB_new = RGB / (alpha/255) # un-premultiply so edges read as pure gold
                              # over any backdrop, not muddied black-gold.
Pixels darker than threshold (4) are wiped to fully transparent.
"""
from PIL import Image
import sys
import pathlib

SRC = pathlib.Path(__file__).parent / "public" / "brand-logo.png"
DST = SRC  # overwrite in place

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

THRESH = 4
for y in range(h):
    for x in range(w):
        r, g, b, _ = px[x, y]
        bright = max(r, g, b)
        if bright < THRESH:
            px[x, y] = (0, 0, 0, 0)
        else:
            scale = 255.0 / bright
            nr = min(255, int(r * scale))
            ng = min(255, int(g * scale))
            nb = min(255, int(b * scale))
            px[x, y] = (nr, ng, nb, bright)

img.save(DST, "PNG")
print(f"wrote {DST}  size={w}x{h}")
