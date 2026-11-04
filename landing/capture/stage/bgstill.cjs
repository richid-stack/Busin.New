const { chromium } = require('playwright'); const path = require('path')
;(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
  await p.goto('file://' + path.resolve(__dirname, 'stage.html') + '?scene=bg'); await p.evaluate(() => { window.render(0) })
  await p.screenshot({ path: path.resolve(__dirname, 'bg.png') }); await b.close() })()
