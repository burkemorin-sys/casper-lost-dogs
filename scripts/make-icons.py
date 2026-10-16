"""Generate PWA / Android icons (paw print on terracotta). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os
BG = (200, 85, 61); FG = (255, 246, 234)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def paw(size, scale, rounded, radius_frac=0.22):
    S = size * 4  # supersample
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_frac), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    # paw geometry on a 64-unit grid (same as favicon.svg), scaled about center
    u = S / 64 * scale; c = S / 2
    P = lambda x, y: (c + (x - 32) * u, c + (y - 32) * u)
    def ell(cx, cy, rx, ry):
        x, y = P(cx, cy); d.ellipse([x - rx * u, y - ry * u, x + rx * u, y + ry * u], fill=FG)
    ell(32, 40, 12, 10); ell(18, 28, 5, 5); ell(26, 19, 5, 5); ell(38, 19, 5, 5); ell(46, 28, 5, 5)
    return im.resize((size, size), Image.LANCZOS)

for s in (48, 72, 96, 128, 144, 152, 192, 256, 384, 512):
    paw(s, 1.0, False).save(f'{OUT}/icon-{s}.png')          # "any" purpose, full-bleed square
for s in (192, 512):
    paw(s, 0.72, False).save(f'{OUT}/maskable-{s}.png')     # paw inside the 80% safe zone
paw(180, 0.9, False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')  # iOS adds its own rounding
paw(32, 1.0, True).save(f'{OUT}/favicon-32.png')
# Android adaptive icon foreground for Capacitor (transparent bg, paw in safe zone)
fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
p = paw(432, 0.62, False); px = p.load()
for y in range(432):
    for x in range(432):
        r, g, b, a = px[x, y]
        # keep only light (paw) pixels; anti-aliased edge alpha from brightness
        t = max(0, min(1, (g - BG[1]) / (FG[1] - BG[1])))
        px[x, y] = (FG[0], FG[1], FG[2], int(255 * t))
pass
print('icons written to', os.path.abspath(OUT))

# Pre-rendered Android launcher resources, copied over the Capacitor template in CI
RES = os.path.join(os.path.dirname(__file__), '..', 'capacitor', 'android-res')
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in dens.items():
    dd = os.path.join(RES, f'mipmap-{name}'); os.makedirs(dd, exist_ok=True)
    paw(int(48 * k), 1.0, True).save(f'{dd}/ic_launcher.png')
    # round legacy icon
    r = paw(int(48 * k), 1.0, True, radius_frac=0.5); r.save(f'{dd}/ic_launcher_round.png')
    p.resize((int(108 * k), int(108 * k)), Image.LANCZOS).save(f'{dd}/ic_launcher_foreground.png')
vd = os.path.join(RES, 'values'); os.makedirs(vd, exist_ok=True)
open(f'{vd}/ic_launcher_background.xml', 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#C8553D</color>\n</resources>\n')
print('android res written to', os.path.abspath(RES))
