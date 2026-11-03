/** Renders caption lines as transparent PNGs: node captions.cjs captions.json outdir */
const { chromium } = require('playwright'); const fs = require('fs')
;(async () => {
  const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const out = process.argv[3]; fs.mkdirSync(out, { recursive: true })
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 300 } })
  for (const [id, html] of Object.entries(items)) {
    await p.setContent(`<html><body style="margin:0;background:transparent"><div id="c" style="display:inline-block;padding:6px 10px;font:500 58px/1.15 Inter,sans-serif;letter-spacing:-0.05em;color:#fff;white-space:nowrap"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#09f;margin-right:22px;vertical-align:12px;box-shadow:0 0 20px #09f"></span>${html.replace(/<b>/g, '<b style="background:linear-gradient(90deg,#09f,#8b5cf6);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:500">')}</div></body></html>`)
    await p.evaluate(() => document.fonts.ready)
    await p.locator('#c').screenshot({ path: `${out}/${id}.png`, omitBackground: true })
  }
  await b.close(); console.log('captions', Object.keys(items).length)
})()
