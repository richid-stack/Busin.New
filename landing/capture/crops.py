#!/usr/bin/env python3
"""Cuts close-ups out of the full-size screenshots in media/shots (the same pixels, just the part that matters).
    python3 landing/capture/crops.py
Output: landing/media/crops/<name>.webp"""
import os, json
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); SH = f'{HERE}/../media/shots'; OUT = f'{HERE}/../media/crops'
os.makedirs(OUT, exist_ok=True)
C = {
 'approval':     ('chat-approval-dark', (980, 420, 2380, 880)),
 'trace':        ('chat-trace-dark', (960, 150, 2400, 1000)),
 'checks':       ('task-checked-dark', (940, 160, 2400, 1000)),
 'checks-light': ('task-checked-light', (940, 160, 2400, 1000)),
 'partial':      ('task-partial-dark', (940, 160, 2400, 1000)),
 'canvas':       ('workflow-canvas-dark', (520, 380, 2800, 1487)),
 'canvas-wide':  ('workflow-canvas-dark', (540, 800, 2800, 1090)),
 'computers':    ('computers-dark', (940, 380, 2440, 1320)),
 'agents':       ('agents-dark', (940, 380, 2640, 1000)),
 'integrations': ('integrations-dark', (1000, 360, 2380, 1000)),
 'reef':         ('reef-dark', (720, 100, 2000, 1000)),
 'reef-light':   ('reef-light', (720, 100, 2000, 1000)),
 'memory':       ('memory-dark', (940, 368, 2400, 1068)),
 'models':       ('models-dark', (940, 425, 2400, 1125)),
 'home':         ('home-dark', (830, 230, 2530, 1180)),
 'chart':        ('chat-chart-light', (940, 200, 2400, 1250)),
 'workflows':    ('workflows-dark', (940, 200, 2400, 1000)),
 'reef-project': ('reef-project-dark', (720, 100, 2000, 1000)),
}
sizes = {}
for k, (src, box) in C.items():
    im = Image.open(f'{SH}/{src}.webp').convert('RGB').crop(box)
    if im.width > 1500: im = im.resize((1500, round(im.height * 1500 / im.width)), Image.LANCZOS)
    im.save(f'{OUT}/{k}.webp', quality=82, method=6); sizes[k] = im.size
json.dump(sizes, open('/tmp/claude-0/crops/sizes.json', 'w'))
print({k: v for k, v in sizes.items()}, sum(os.path.getsize(f'{OUT}/{k}.webp') for k in C) // 1024, 'KB')
