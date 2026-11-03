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
ring_a = Image.eval(Image.composite(Image.new('L', (CW, CH), 0), outer, inner), lambda v: v)  # outer minus inner
ring = Image.new('RGBA', (CW, CH), (255, 255, 255, 0)); ring.putalpha(ring_a.point(lambda v: int(v * 0.16))); ring.save(f'{HERE}/ring.png')
sh = Image.new('L', (CW + 2 * M, CH + 2 * M), 0); sh.paste(rr(CW, CH, R, 235), (M, M + 44)); sh = sh.filter(ImageFilter.GaussianBlur(52))
shadow = Image.new('RGBA', sh.size, (0, 0, 0, 0)); shadow.putalpha(sh); shadow.save(f'{HERE}/shadow.png')
print('card pieces written')
