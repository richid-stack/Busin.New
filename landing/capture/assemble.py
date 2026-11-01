#!/usr/bin/env python3
"""
Joins finished scenes into a video: scenes are concatenated without re-encoding (they share one encoder setting), the
soundtrack is generated to fit their cut points, and the result is written as a 1080p master plus a small web copy and a poster.
    python3 assemble.py ad-main intro chat_ad approval_ad ...
Masters go to landing/media/master (kept out of git); web copies and posters go to landing/media/video.
"""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); M = os.path.join(HERE, '../media')
SC, MASTER, VID, TMP = f'{M}/scenes', f'{M}/master', f'{M}/video', '/tmp/claude-0/assemble'
for d in (MASTER, VID, TMP): os.makedirs(d, exist_ok=True)
def run(c):
    r = subprocess.run(c, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:]); sys.exit(1)
    return r
def dur(f): return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout)
def assemble(name, scenes, music=True):
    files = [f'{SC}/{s}.mp4' for s in scenes]; ds = [dur(f) for f in files]; total = round(sum(ds), 2)
    cuts, acc = [], 0
    for d in ds[:-1]: acc += d; cuts.append(round(acc, 2))
    lst = f'{TMP}/{name}.txt'; open(lst, 'w').write(''.join(f"file '{os.path.abspath(f)}'\n" for f in files))
    silent = f'{TMP}/{name}.silent.mp4'; run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent])
    wav = f'{TMP}/{name}.wav'; run(['python3', f'{HERE}/music.py', wav, str(total), ','.join(map(str, cuts))])
    tmp = f'{MASTER}/{name}.tmp.mp4'
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
         '-af', f'loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st={total-1.2}:d=1.2', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp])
    os.rename(tmp, f'{MASTER}/{name}.mp4')
    # web copy: 1280x720, small
    tmpw = f'{VID}/{name}.tmp.mp4'
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{MASTER}/{name}.mp4', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', tmpw])
    os.rename(tmpw, f'{VID}/{name}.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(min(total * .3, 12)), '-i', f'{MASTER}/{name}.mp4', '-frames:v', '1', '-vf', 'scale=1280:720', '-c:v', 'libwebp', '-quality', '82', f'{VID}/{name}.webp'])
    print(f'{name}: {total:.1f}s, master {os.path.getsize(f"{MASTER}/{name}.mp4")/1e6:.1f} MB, web {os.path.getsize(f"{VID}/{name}.mp4")/1e6:.1f} MB')
if __name__ == '__main__':
    assemble(sys.argv[1], sys.argv[2:])
