#!/usr/bin/env python3
"""Draws the card pieces the editor lays footage on: mask (rounded corners), ring (hairline border) and shadow.
Sized to the card in edit.py (1640x922). Run once; the PNGs are checked in next to this file."""
from PIL import Image, ImageDraw, ImageFilter
import os
HERE = os.path.dirname(os.path.abspath(__file__))
CW, CH, R, M = 1640, 922, 28, 160
S = 4  # supersample for clean edges
def rr(w, h, r, fill, size=None):
    im = Image.new('L', (w * S, h * S), 0); ImageDraw.Draw(im).rounded_rectangle((0, 0, w * S - 1, h * S - 1), r * S, fill=fill)
    return im.resize((w, h), Image.LANCZOS)
mask = rr(CW, CH, R, 255); mask.save(f'{HERE}/mask.png')
outer = rr(CW, CH, R, 255); inner = Image.new('L', (CW, CH), 0); inner.paste(rr(CW - 4, CH - 4, R - 2, 255), (2, 2))
inner = Image.new('L', (CW, CH), 0); inner.paste(rr(CW - 6, CH - 6, R - 3, 255), (3, 3))
ring_a = Image.eval(Image.composite(Image.new('L', (CW, CH), 0), outer, inner), lambda v: v)  # outer minus inner
# rim light: crisp blue-white edge (brighter at the top left) over a blue bloom, like a lit panel on black
import numpy as np
ra = np.array(ring_a, dtype=np.float32) / 255.0
yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32); d = (xx / CW * .6 + yy / CH * .4)
stops = [(0, (214, 230, 255)), (.28, (74, 155, 255)), (.62, (10, 98, 255)), (1, (6, 54, 200))]
col = np.zeros((CH, CW, 3), np.float32)
for c in range(3): col[..., c] = np.interp(d, [s_[0] for s_ in stops], [s_[1][c] for s_ in stops])
ring = Image.fromarray(np.dstack([col, ra * 255]).astype(np.uint8), 'RGBA'); ring.save(f'{HERE}/ring.png')
dark = Image.new('L', (CW + 2 * M, CH + 2 * M), 0); dark.paste(rr(CW, CH, R, 235), (M, M + 44)); dark = dark.filter(ImageFilter.GaussianBlur(52))
edge = Image.new('L', (CW + 2 * M, CH + 2 * M), 0); edge.paste(ring_a, (M, M))
bl1 = edge.filter(ImageFilter.GaussianBlur(12)).point(lambda v: min(255, int(v * 2.0)))
bl2 = edge.filter(ImageFilter.GaussianBlur(40)).point(lambda v: min(255, int(v * 4.0)))
al = np.maximum(np.array(bl1, np.float32) * 1.0, np.array(bl2, np.float32) * .85)
sh = np.zeros((CH + 2 * M, CW + 2 * M, 4), np.uint8)
sh[..., 0] = 24; sh[..., 1] = 100; sh[..., 2] = 255; sh[..., 3] = np.clip(al, 0, 255).astype(np.uint8)
glow = Image.fromarray(sh, 'RGBA')
shadow = Image.new('RGBA', glow.size, (0, 0, 0, 0)); shadow.putalpha(dark); shadow = Image.alpha_composite(shadow, glow); shadow.save(f'{HERE}/shadow.png')
print('card pieces written')
