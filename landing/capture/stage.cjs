/**
 * Renders the motion-designed scenes (intro, montage, end card, tutorial cards) from landing/capture/stage/stage.html.
 * The page is told what second it is and draws exactly that frame, so every frame is deterministic.
 *   node landing/capture/stage.cjs intro montage outro
 * Output: landing/media/raw/<scene>.mp4 (1920x1080, 30 fps)
 */
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const { execFileSync } = require('child_process')
const RAW = path.resolve(__dirname, '../media/raw'), TMP = '/tmp/claude-0/stage'
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(TMP, { recursive: true })
;(async () => {
  const names = process.argv.slice(2)
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  for (const n of names) {
    const page = await ctx.newPage()
    await page.goto('file://' + path.join(__dirname, 'stage/stage.html') + '?scene=' + n); await page.evaluate(() => document.fonts.ready)
    const dur = await page.evaluate(() => window.DUR); const frames = Math.round(dur * 30)
    const dir = `${TMP}/${n}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir)
    for (let i = 0; i < frames; i++) { await page.evaluate(t => window.render(t), i / 30); await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 }) }
    const out = `${RAW}/${n}.mp4`, tmp = `${RAW}/${n}.tmp.mp4`
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp])
    fs.renameSync(tmp, out); console.log(n, frames, 'frames'); await page.close()
  }
  await b.close()
})()
