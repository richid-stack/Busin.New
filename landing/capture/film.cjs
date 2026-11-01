/**
 * Films the real app (the capture server on :3000) with scripted, human-paced interactions.
 *
 *   node landing/capture/film.cjs chat approval tasks ...     (no names = every scene)
 *
 * How a clip is made: Chromium's screencast hands over a JPEG every time the page repaints, with a timestamp.
 * Those frames are rebuilt into a steady 30 fps H.264 file, so what you see is the page exactly as it drew.
 * A cursor is drawn on top (the browser does not record one) and glides like a hand would. Nothing on the page
 * is faked: the clicks, typing, streaming and tool trace are the app's own. Output: landing/media/raw/<scene>.mp4
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const W = 1600, H = 900, DPR = 1.5
const RAW = path.resolve(__dirname, '../media/raw')
const TMP = '/tmp/claude-0/film'
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(TMP, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur') || !document.documentElement) return
    const c = document.createElement('div'); c.id = '__cur'
    c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))'
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3l16 9.5-7 1.8-3.6 6.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    const r = document.createElement('div'); r.id = '__rip'
    r.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(47,123,255,.9);z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.3)'
    document.documentElement.appendChild(r)
    addEventListener('mousemove', e => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, true)
    addEventListener('mousedown', e => {
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
      r.animate([{ opacity: .9, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 520, easing: 'ease-out' })
    }, true)
  }
  try { mk() } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { try { mk() } catch (e) {} })
})()`

class Film {
  constructor(name) { this.name = name; this.dir = `${TMP}/${name}`; this.frames = []; this.mx = 800; this.my = 450 }
  async open(browser, { dark = false, url = '/', wait = null } = {}) {
    fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true })
    this.ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'no-preference' })
    await this.ctx.addInitScript(CURSOR)
    this.page = await this.ctx.newPage()
    await this.page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
    if (wait) await this.page.getByText(wait).first().waitFor({ timeout: 30000 }).catch(() => console.log('  (did not see', wait, ')'))
    await this.page.mouse.move(this.mx, this.my)
    await sleep(900)
    return this.page
  }
  async start() {
    this.cdp = await this.ctx.newCDPSession(this.page)
    this.t0 = null
    this.cdp.on('Page.screencastFrame', async ev => {
      const t = ev.metadata.timestamp
      if (this.t0 == null) this.t0 = t
      const i = this.frames.length
      const f = `${this.dir}/f${String(i).padStart(5, '0')}.jpg`
      fs.writeFileSync(f, Buffer.from(ev.data, 'base64'))
      this.frames.push({ f, t: t - this.t0 })
      this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(W * DPR), maxHeight: Math.round(H * DPR), everyNthFrame: 1 })
    this.wall = Date.now()
    await sleep(250)
  }
  async glide(x, y, ms = 650) {
    const sx = this.mx, sy = this.my, n = Math.max(6, Math.round(ms / 16))
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n)
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
      await sleep(ms / n)
    }
    this.mx = x; this.my = y
  }
  async over(locator, ms = 650, dx = 0.5, dy = 0.5) {
    const el = locator.first()
    await el.scrollIntoViewIfNeeded().catch(() => {})
    const b = await el.boundingBox()
    if (!b) throw new Error('no box for target')
    await this.glide(b.x + b.width * dx, b.y + b.height * dy, ms)
  }
  async click(locator, ms = 650) { await this.over(locator, ms); await sleep(120); await this.page.mouse.down(); await sleep(70); await this.page.mouse.up(); await sleep(150) }
  async type(text, perChar = 38) { for (const ch of text) { await this.page.keyboard.type(ch); await sleep(perChar + Math.random() * 22) } }
  async scrollTo(y, ms = 900, sel = null) {
    await this.page.evaluate(async ({ y, ms, sel }) => {
      const el = sel ? document.querySelector(sel) : (document.scrollingElement)
      const s = el.scrollTop, t0 = performance.now()
      await new Promise(res => { const step = () => { const p = Math.min(1, (performance.now() - t0) / ms); const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; el.scrollTop = s + (y - s) * e; p < 1 ? requestAnimationFrame(step) : res() }; step() })
    }, { y, ms, sel })
  }
  async stop() {
    await sleep(300)
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    await this.ctx.close()
    const fr = this.frames
    if (fr.length < 2) throw new Error('no frames for ' + this.name)
    // Last frame is held briefly so the clip does not end on a cut.
    const list = fr.map((x, i) => `file '${x.f}'\nduration ${Math.max(0.001, (fr[i + 1] ? fr[i + 1].t - x.t : 0.25)).toFixed(4)}`).join('\n') + `\nfile '${fr[fr.length - 1].f}'\n`
    fs.writeFileSync(`${this.dir}/list.txt`, list)
    const tmp = `${RAW}/${this.name}.tmp.mp4`
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${this.dir}/list.txt`, '-vf', `fps=30,scale=${Math.round(W * DPR)}:${Math.round(H * DPR)}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp])
    fs.renameSync(tmp, `${RAW}/${this.name}.mp4`)
    const dur = fr[fr.length - 1].t
    console.log(`  ${this.name}: ${fr.length} frames over ${dur.toFixed(1)} s (${(fr.length / dur).toFixed(1)} repaints/s)`)
  }
}

async function api(p) { return (await fetch(BASE + p)).json() }

const scenes = {
  // Ask, watch the tools run, get the answer.
  async chat(b) {
    const f = new Film('chat'); const page = await f.open(b, { url: '/', wait: 'Good morning, Ama' })
    await f.start()
    const box = page.locator('textarea').first()
    await f.click(box, 800)
    await f.type('A customer ordered 12 chairs at GH₵ 350 each, plus GH₵ 120 delivery. What is the total? Plan the week for me.')
    await sleep(500)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.body.innerText.includes('Thursday morning'), null, { timeout: 40000 }).catch(() => console.log('  (no answer seen)'))
    await sleep(2600)
    await f.stop()
  },

  // A step that asks before it acts.
  async approval(b) {
    const chats = await api('/api/chats'); const c = chats.find(x => /Invite the team/.test(x.title))
    const f = new Film('approval'); const page = await f.open(b, { url: `/chat/${c.id}`, wait: 'Invite the team' })
    await f.start(); await sleep(1200)
    const approve = page.getByRole('button', { name: /approve|allow|yes/i }).first()
    await f.over(approve, 900).catch(() => {})
    await sleep(2800)
    await f.stop()
  },

  // Goals with checks: open a finished task, then one that only partly passed.
  async tasks(b) {
    const f = new Film('tasks'); const page = await f.open(b, { url: '/tasks', wait: 'Compare the three best' })
    await f.start(); await sleep(900)
    await f.over(page.getByText('Read last quarter').first(), 900); await sleep(500)
    await f.click(page.getByText('Compare the three best').first(), 800)
    await page.getByText('Each app has its current price').first().waitFor({ timeout: 20000 }).catch(() => {})
    await sleep(1700)
    await f.over(page.getByText('Each app has its current price').first(), 800); await sleep(1500)
    await page.goBack({ waitUntil: 'networkidle' }).catch(() => {}); await sleep(900)
    await f.click(page.getByText('Check that our pricing page loads').first(), 800)
    await page.getByText('Buy button').first().waitFor({ timeout: 20000 }).catch(() => {})
    await sleep(1500); await f.over(page.getByText('Buy button').first(), 900); await sleep(2600)
    await f.stop()
  },

  async workflow(b) {
    const wf = await api('/api/workflows'); const id = wf.find(w => w.title === 'Weekly competitor snapshot').id
    const f = new Film('workflow'); const page = await f.open(b, { url: '/workflows', wait: 'Weekly competitor snapshot' })
    await f.start(); await sleep(800)
    await f.click(page.getByText('Weekly competitor snapshot').first(), 800)
    await page.waitForURL(/workflows\//, { timeout: 20000 }).catch(() => {})
    await page.locator('.vue-flow__node', { hasText: 'Read their page' }).first().waitFor({ timeout: 20000 }).catch(() => {})
    await sleep(900)
    await page.getByTitle('Toggle node library').first().click({ timeout: 3000 }).catch(() => {})
    await sleep(500)
    await f.click(page.locator('.vue-flow__controls-fitview'), 700); await sleep(900)
    for (const t of ['Schedule', 'Read their page', 'Write the brief', 'Email me the brief']) { await f.over(page.locator('.vue-flow__node', { hasText: t }), 600); await sleep(500) }
    await sleep(700)
    await f.stop()
  },

  async agents(b) {
    const f = new Film('agents'); const page = await f.open(b, { url: '/agents', wait: 'Inbox helper' })
    await f.start(); await sleep(1000)
    await f.over(page.getByText('Inbox helper').first(), 900); await sleep(1100)
    await page.goto(BASE + '/memory', { waitUntil: 'networkidle' }).catch(() => {}); await page.getByText('Akosua Interiors').first().waitFor({ timeout: 20000 }).catch(() => {})
    await sleep(900); await f.over(page.getByText('Akosua Interiors').first(), 800); await sleep(1200)
    await f.stop()
  },

  async reef(b) {
    const f = new Film('reef'); const page = await f.open(b, { url: '/reef', wait: 'Efua Tetteh' })
    await f.start(); await sleep(1100)
    await f.scrollTo(380, 1000); await sleep(700)
    await f.click(page.getByText('Projects').first(), 800).catch(() => {})
    await page.waitForURL(/reef\/projects/, { timeout: 15000 }).catch(() => {})
    await sleep(1100)
    await f.click(page.getByText('writing-desk').first(), 800)
    await page.waitForURL(/writing-desk/, { timeout: 15000 }).catch(() => {})
    await sleep(2200)
    await f.stop()
  },

  async computers(b) {
    const f = new Film('computers'); const page = await f.open(b, { url: '/computers', wait: 'Ama’s laptop' })
    await f.start(); await sleep(1200)
    await f.over(page.getByText('Online now').first(), 800); await sleep(700)
    await f.over(page.getByText('What the Bridge can and cannot do').first(), 800); await sleep(1700)
    await f.click(page.getByRole('button', { name: 'Add a computer' }), 800)
    await sleep(1400); await f.over(page.locator('code, pre').first(), 900); await sleep(3200)
    await f.stop()
  },

  // Bring your own key: open a provider's connect box and type into it (nothing is submitted).
  async models(b) {
    const f = new Film('models'); const page = await f.open(b, { url: '/models', wait: 'Choose a provider' })
    await f.start(); await sleep(1000)
    await f.over(page.getByText('Google Gemini').first(), 800); await sleep(500)
    await f.over(page.getByText('Groq').first(), 700); await sleep(500)
    await f.click(page.getByRole('button', { name: 'Connect' }).first(), 800)
    await sleep(1200)
    const input = page.locator('input[type=password], input[type=text]:visible').last()
    await f.click(input, 700).catch(() => {})
    await f.type('sk-live-xxxxxxxxxxxxxxxxxxxx', 55)
    await sleep(2200)
    await f.stop()
  },

  async settings(b) {
    const f = new Film('settings'); const page = await f.open(b, { url: '/settings', wait: 'Assistant browser' })
    await f.start(); await sleep(1100)
    await f.over(page.getByText('Assistant browser').first(), 900); await sleep(1800)
    await f.scrollTo(380, 900); await sleep(1500)
    await f.stop()
  },

  async integrations(b) {
    const f = new Film('integrations'); const page = await f.open(b, { url: '/integrations', wait: 'Installed' })
    await f.start(); await sleep(1100)
    await f.scrollTo(300, 1000); await sleep(900)
    await f.over(page.getByText('Slack').first(), 800); await sleep(1500)
    await f.stop()
  }
}

;(async () => {
  const want = process.argv.slice(2); const names = want.length ? want : Object.keys(scenes)
  const b = await chromium.launch()
  for (const n of names) { console.log('filming', n); try { await scenes[n](b) } catch (e) { console.log('  FAILED', n, e.message) } }
  await b.close()
})()
