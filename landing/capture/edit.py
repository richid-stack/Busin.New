#!/usr/bin/env python3
"""
Edits the filmed clips into finished scenes (one encoded file each, 1920x1080, 30 fps).

A footage scene is: the real app clip, cut into segments with speed changes, pushed in with eased zooms inside a
rounded card, on the shared dark background; caption lines slide up under it; the card slides in from the right and
out to the left with a little motion blur. Nothing in the clip itself is altered except speed and zoom.

    python3 landing/capture/edit.py chat approval ...      (no names = all)
"""
import json, os, subprocess, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '../media/raw'); OUT = os.path.join(HERE, '../media/scenes'); ST = os.path.join(HERE, 'stage'); TMP = '/tmp/claude-0/edit'
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
CW, CH, CX, CY = 1640, 922, 140, 36     # the card
FPS = 30

def smooth(keys, getter):
    """Piecewise smoothstep through keyframes [(t, ...)] -> ffmpeg expression in variable T."""
    ks = sorted(keys, key=lambda k: k[0])
    e = f"{getter(ks[-1]):.4f}"
    for i in range(len(ks) - 2, -1, -1):
        a, b = ks[i], ks[i + 1]
        u = f"((T-{a[0]:.3f})/{b[0]-a[0]:.3f})"
        s = f"({u}*{u}*(3-2*{u}))"
        seg = f"({getter(a):.4f}+({getter(b)-getter(a):.4f})*{s})"
        e = f"if(lt(T,{b[0]:.3f}),{seg},{e})"
    return f"if(lt(T,{ks[0][0]:.3f}),{getter(ks[0]):.4f},{e})"

def timeline(segs):
    """segs: [(src_start, src_end, speed)] -> total timeline seconds."""
    return sum((b - a) / sp for a, b, sp in segs)

SCENES = {
 'chat': dict(src='chat', segs=[(1.0, 1.6, 1.0), (1.6, 9.0, 3.6), (9.0, 9.7, 1.0), (9.7, 10.9, 1.8), (10.9, 14.9, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.5, 1.55, .575, .31), (2.6, 1.55, .575, .31), (3.3, 1.2, .55, .2), (4.5, 1.35, .56, .24), (6.0, 1.7, .56, .31)],
   caps=[(.3, 2.6, 'Ask in <b>plain language</b>.'), (2.7, 4.4, 'Each <b>tool step</b> is listed.'), (4.5, None, 'Then it <b>plans the week</b>.')]),
 'approval': dict(src='approval', segs=[(0.5, 5.9, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.8, 1.8, .575, .37), (4.0, 1.8, .575, .37)],
   box=(1.3, 1e9, 860, 316, 1050, 352),
   caps=[(.5, None, 'Approval <b>before</b> any change.')]),
 'tasks': dict(src='tasks', segs=[(0.3, 1.5, 1.0), (4.7, 6.8, 1.0), (7.2, 10.6, 1.15), (12.8, 16.2, 1.0)],
   zoom=[(0, 1.0, .5, .5), (3.1, 1.0, .5, .5), (3.7, 1.4, .5, .45), (6.1, 1.4, .5, .45), (6.3, 1.4, .5, .42)],
   caps=[(.3, 3.0, 'Set a <b>goal</b>.'), (3.3, 6.1, 'Success is <b>verified</b>.'), (6.3, None, 'Unmet checks are <b>reported</b>.')]),
 'workflow': dict(src='workflow', segs=[(2.4, 4.3, 1.0), (6.4, 18.2, 2.4)],
   zoom=[(0, 1.0, .5, .5), (1.9, 1.0, .5, .5), (2.9, 1.4, .55, .52), (6.8, 1.4, .55, .52)],
   caps=[(.4, 2.2, 'Select a workflow.'), (2.3, None, 'Automation on a <b>canvas</b>.')]),
 'agents': dict(src='agents', segs=[(0.5, 3.9, 1.6), (5.2, 8.2, 1.6)],
   zoom=[(0, 1.0, .5, .5), (.6, 1.35, .46, .42), (1.8, 1.35, .46, .42), (2.1, 1.0, .5, .5), (2.6, 1.3, .5, .4)],
   caps=[(.3, 2.0, 'Agents with their <b>own tools</b>.'), (2.1, None, 'Memory under <b>your control</b>.')]),
 'reef': dict(src='reef', segs=[(0.5, 4.2, 1.3), (5.5, 8.6, 1.3)],
   zoom=[(0, 1.0, .5, .5)],
   caps=[(.3, 2.9, 'Publish what works.'), (3.0, None, '<b>Fork</b> shared agents.')]),
 'computers': dict(src='computers', segs=[(0.8, 7.1, 3.4), (7.1, 13.6, 1.9)],
   zoom=[(0, 1.0, .5, .5), (1.9, 1.0, .5, .5), (2.7, 1.5, .5, .5)],
   caps=[(.3, 2.0, 'Your computer, <b>with permission</b>.'), (2.2, None, 'Pair with a <b>one-time code</b>.')]),
 'integrations': dict(src='integrations', segs=[(0.4, 4.8, 1.4)],
   zoom=[(0, 1.0, .5, .5), (1.3, 1.3, .45, .78)],
   caps=[(.3, None, 'Your apps, <b>in one place</b>.')]),
 'newtask': dict(src='newtask', segs=[(0.8, 2.4, 1.0), (2.4, 8.4, 3.0), (8.4, 17.8, 2.2), (17.8, 20.4, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.6, 1.5, .57, .42), (7.5, 1.5, .57, .5)],
   caps=[(.3, 3.4, 'Describe a <b>complex job</b>.'), (3.6, 7.8, 'Add <b>checks</b> for success.'), (8.0, None, 'Run it on a <b>schedule</b>.')]),
 'bug': dict(src='bug', segs=[(0.7, 6.4, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.8, 1.4, .55, .42)],
   caps=[(.4, None, 'Two apps, <b>one request</b>.')]),
 'sales': dict(src='sales', segs=[(0.8, 6.0, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.8, 1.5, .5, .45)],
   caps=[(.4, None, 'Numbers become a <b>chart</b>.')]),
 'models': dict(src='models', segs=[(0.6, 4.4, 1.5), (4.4, 12.0, 1.9)],
   zoom=[(0, 1.0, .5, .5), (2.8, 1.0, .5, .5), (3.6, 1.45, .5, .5)],
   caps=[(.3, 2.6, 'Bring <b>your own</b> key.'), (2.8, None, 'Keys are <b>encrypted</b>.')]),
}
# Tighter cuts of the longer scenes for the 50-second ad (the full versions above are for the feature clips).
SCENES['chat_ad'] = dict(SCENES['chat'], segs=[(1.0, 1.5, 1.0), (1.5, 9.0, 4.4), (9.0, 9.6, 1.0), (9.6, 10.9, 2.2), (10.9, 13.4, 1.0)],
   zoom=[(0, 1.0, .5, .5), (.4, 1.55, .575, .31), (2.0, 1.55, .575, .31), (2.6, 1.2, .55, .2), (3.6, 1.35, .56, .24), (4.6, 1.7, .56, .31)],
   caps=[(.3, 2.0, 'Ask in <b>plain language</b>.'), (2.1, 3.4, 'Each <b>tool step</b> is listed.'), (3.5, None, 'Then it <b>plans the week</b>.')])
SCENES['approval_ad'] = dict(SCENES['approval'], segs=[(0.5, 5.0, 1.0)])
SCENES['tasks_ad'] = dict(SCENES['tasks'], segs=[(0.3, 1.0, 1.0), (5.6, 6.8, 1.0), (7.6, 9.8, 1.0), (13.5, 16.0, 1.0)],
   zoom=[(0, 1.0, .5, .5), (1.7, 1.0, .5, .5), (2.3, 1.4, .5, .45), (3.9, 1.4, .5, .45), (4.3, 1.4, .5, .42)],
   caps=[(.3, 1.8, 'Set a <b>goal</b>.'), (2.0, 4.0, 'Success is <b>verified</b>.'), (4.2, None, 'Unmet checks are <b>reported</b>.')])
SCENES['workflow_ad'] = dict(SCENES['workflow'], segs=[(2.6, 4.1, 1.0), (6.7, 18.2, 3.3)],
   zoom=[(0, 1.0, .5, .5), (1.3, 1.0, .5, .5), (2.1, 1.4, .55, .52), (5.3, 1.4, .55, .52)],
   caps=[(.3, 1.7, 'Select a workflow.'), (1.8, None, 'Automation on a <b>canvas</b>.')])
SCENES['reef_ad'] = dict(SCENES['reef'], segs=[(0.5, 4.2, 1.8), (5.5, 8.6, 1.8)], caps=[(.3, 2.0, 'Publish what works.'), (2.1, None, '<b>Fork</b> shared agents.')])

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1800:]); sys.exit(1)

def build(name, cfg, total_override=None):
    segs = cfg['segs']; D = timeline(segs)
    # land cuts on the half-second grid the music uses: stretch or trim the last segment
    target = max(0.5, round(D * 2) / 2)
    a, b, sp = segs[-1]; need = target - (D - (b - a) / sp)
    segs = segs[:-1] + [(a, a + need * sp, sp)]; D = target
    capdir = f'{TMP}/caps'
    parts, labels = [], []
    for i, (a, b, sp) in enumerate(segs):
        parts.append(f"[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp},fps={FPS}[s{i}]"); labels.append(f"[s{i}]")
    g = ';'.join(parts) + f";{''.join(labels)}concat=n={len(segs)}:v=1:a=0[tl]"
    last = 'tl'
    if cfg.get('box'):
        t0, t1, x, y, w, h = cfg['box']
        g += f";[{last}]drawbox=x={x}:y={y}:w={w}:h={h}:color=0x0099ff@0.95:t=6:enable='between(t,{t0},{min(t1, D)})'[bx]"; last = 'bx'
    Z = smooth(cfg['zoom'], lambda k: k[1]).replace('T', '(on/30)')
    FX = smooth(cfg['zoom'], lambda k: k[2]).replace('T', '(on/30)'); FY = smooth(cfg['zoom'], lambda k: k[3]).replace('T', '(on/30)')
    g += (f";[{last}]zoompan=z='{Z}':x='max(0,min(iw-iw/zoom,({FX})*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,({FY})*ih-ih/zoom/2))'"
          f":d=1:s={CW}x{CH}:fps={FPS},format=yuva420p[cardv]")
    g += f";[cardv][2:v]alphamerge[card]"
    slide = f"{CX}+pow(1-min(t/0.5,1),5)*1900-pow(max(0,(t-({D}-0.42))/0.42),3)*2000"
    g += f";[1:v]format=yuv420p[bg]"
    g += f";[bg][3:v]overlay=x='({slide})-160':y={CY}-160:eval=frame:format=auto[b1]"
    g += f";[b1][card]overlay=x='{slide}':y={CY}:eval=frame:format=auto[b2]"
    g += f";[b2][4:v]overlay=x='{slide}':y={CY}:eval=frame:format=auto[b3]"
    cur = 'b3'
    for i, (t0, t1, txt) in enumerate(cfg['caps']):
        t1 = D - 0.35 if t1 is None else t1
        idx = 5 + i
        g += (f";[{idx}:v]format=rgba,fade=t=in:st={t0}:d=0.28:alpha=1,fade=t=out:st={t1-0.25}:d=0.25:alpha=1[c{i}]"
              f";[{cur}][c{i}]overlay=x={CX}-6:y='968+(1-(1-pow(1-min(max(t-{t0},0)/0.38,1),3)))*34':enable='between(t,{t0},{t1})':eval=frame:format=auto[b4{i}]")
        cur = f'b4{i}'
    # Whip-pan smear: the picture is smeared sideways only while the card is moving fast.
    smear = [(0, .1, 130), (.1, .18, 64), (.18, .28, 24), (D - .22, D - .12, 40), (D - .12, D + 1, 150)]
    for k, (a, b, px) in enumerate(smear):
        g += f";[{cur}]avgblur=sizeX={px}:sizeY=1:enable='between(t,{a:.3f},{b:.3f})'[sm{k}]"; cur = f'sm{k}'
    g += f";[{cur}]format=yuv420p[out]"
    inputs = ['-i', f'{RAW}/{cfg["src"]}.mp4',
              '-loop', '1', '-framerate', str(FPS), '-t', str(D), '-i', f'{ST}/bg.png',
              '-loop', '1', '-framerate', str(FPS), '-t', str(D), '-i', f'{ST}/mask.png',
              '-loop', '1', '-framerate', str(FPS), '-t', str(D), '-i', f'{ST}/shadow.png',
              '-loop', '1', '-framerate', str(FPS), '-t', str(D), '-i', f'{ST}/ring.png']
    for i, (t0, t1, txt) in enumerate(cfg['caps']):
        inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(D), '-i', f'{capdir}/{name}_{i}.png']
    tmp = f'{OUT}/{name}.tmp.mp4'
    run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', g, '-map', '[out]', '-t', str(D), '-r', str(FPS),
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp])
    os.rename(tmp, f'{OUT}/{name}.mp4'); print(f'  {name}: {D:.1f}s')
    return D

if __name__ == '__main__':
    names = sys.argv[1:] or list(SCENES)
    caps = {}
    for n in names:
        for i, (t0, t1, txt) in enumerate(SCENES[n]['caps']): caps[f'{n}_{i}'] = txt
    json.dump(caps, open(f'{TMP}/captions.json', 'w'))
    run(['node', os.path.join(HERE, 'captions.cjs'), f'{TMP}/captions.json', f'{TMP}/caps'])
    lens = {n: build(n, SCENES[n]) for n in names}
    json.dump(lens, open(f'{TMP}/lens_{"_".join(names)[:40]}.json', 'w'))
    print('total', sum(lens.values()))
