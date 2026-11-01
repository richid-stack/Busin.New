// Takes the product photographs from the capture server (see server.mts). Run the server first.
//   node landing/capture/shots.cjs
const { chromium } = require('playwright')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const BASE = process.env.CAPTURE_BASE || 'http://localhost:4010'
const OUT = 'landing/media/shots'
const RAW = '/tmp/claude-0/shotsraw'
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(RAW, { recursive: true })
const api = async p => (await fetch(BASE + p)).json()

;(async () => {
  const chats = await api('/api/chats'); const wf = await api('/api/workflows'); const tk = await api('/api/tasks')
  const chat = t => chats.find(c => c.title === t)?.id
  const task = (pred) => tk.find(pred)?.id
  const shots = [
    // name, path, wait-for text (so we never photograph a half-loaded page), extra action
    ['home', '/', 'Good morning, Ama'],
    ['chat-trace', `/chat/${chat('File a bug')}`, 'Login bug'],
    ['chat-approval', `/chat/${chat('Invite the team')}`, 'Stock count'],
    ['chat-chart', `/chat/${chat('Weekly sales numbers')}`, 'Sales grew'],
    ['tasks', '/tasks', 'Compare the three best'],
    ['task-checked', `/tasks/${task(t => t.status === 'done' && /Compare/.test(t.goal))}`, 'Each app has its current price'],
    ['task-partial', `/tasks/${task(t => t.status === 'partial')}`, 'Buy button'],
    ['workflows', '/workflows', 'Digest of links'],
    ['workflow-canvas', `/workflows/${wf.find(w => w.title === 'Weekly competitor snapshot').id}`, null],
    ['agents', '/agents', 'Inbox helper'],
    ['memory', '/memory', 'Akosua Interiors'],
    ['integrations', '/integrations', null],
    ['models', '/models', null],
    ['computers', '/computers', null],
    ['reef', '/reef', 'Trending projects'],
    ['reef-projects', '/reef/projects', 'writing-desk'],
    ['reef-project', '/reef/openlobs/writing-desk', 'writing-desk']
  ]
  const b = await chromium.launch()
  for (const [theme, label] of [['light', 'light'], ['dark', 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme })
    const page = await ctx.newPage()
    for (const [name, path, wait] of shots) {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
      if (wait) await page.getByText(wait).first().waitFor({ timeout: 20000 }).catch(() => console.log('  (did not see', wait, 'on', name, ')'))
      await page.waitForTimeout(1600)
      if (name === 'workflow-canvas') {
        // The app's own controls: hide the node library, then "Fit view".
        await page.getByTitle('Toggle node library').first().click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(500)
        await page.locator('.vue-flow__controls-fitview').first().click({ timeout: 3000 }).catch(() => console.log('  (no fit button)'))
        for (let i = 0; i < 0; i++) { await page.locator('.vue-flow__controls-zoomin').first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(250) }
        await page.waitForTimeout(900)
      }
      const png = `${RAW}/${name}-${label}.png`
      await page.screenshot({ path: png })
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', `${OUT}/${name}-${label}.webp`])
      console.log(theme, name)
    }
    await ctx.close()
  }
  // Phone
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: theme, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    for (const [name, path, wait] of [['m-home', '/', 'Good morning, Ama'], ['m-chat-trace', `/chat/${chat('File a bug')}`, 'Login bug'], ['m-tasks', '/tasks', 'Compare the three best'], ['m-reef', '/reef', null]]) {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
      if (wait) await page.getByText(wait).first().waitFor({ timeout: 20000 }).catch(() => console.log('  (did not see', wait, 'on', name, ')'))
      await page.waitForTimeout(1400)
      const png = `${RAW}/${name}-${theme}.png`
      await page.screenshot({ path: png })
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '80', `${OUT}/${name}-${theme}.webp`])
      console.log('phone', theme, name)
    }
    await ctx.close()
  }
  await b.close()
})()
