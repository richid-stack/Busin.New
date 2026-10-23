import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ALWAYS_ALLOWED, HANDLERS, run } from '../bridge/core'
import type { Deps } from '../bridge/core'
import { fileControl, requestQuit, setPaused } from '../bridge/control'
import type { BridgeState, Control } from '../bridge/control'
import { TRAY_SCRIPT, startTray } from '../bridge/tray'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const waitFor = async (what: string, fn: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(20) } throw new Error(`Timed out: ${what}`) }

// ---- The switch files ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olb-tray-'))
const fc = fileControl(dir)
assert(!fc.paused() && !fc.quitRequested(), 'nothing is paused at the start')
setPaused(dir, true)
assert(fc.paused(), 'pausing is one small file')
setPaused(dir, false)
assert(!fc.paused(), 'resuming removes it')
requestQuit(dir)
assert(fc.quitRequested(), 'quit is one small file')
const sample: BridgeState = { version: '0.4.0', name: 'Desk', server: 'https://x.example', connected: true, paused: false, busy: null, at: new Date().toISOString() }
fc.publish(sample)
assert(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).name === 'Desk' && fs.readdirSync(dir).every(f => !/\.\d+$/.test(f)), 'the status board is written whole and leaves no half-written copies')
fs.rmSync(dir, { recursive: true, force: true })

// ---- The running Bridge obeys them ----
const calls: Array<{ path: string, body: any }> = []
let jobsToSend: any[] = []
const states: BridgeState[] = []
const logs: string[] = []
let pausedNow = false
let quitNow = false
const control: Control = { paused: () => pausedNow, quitRequested: () => quitNow, publish: s => states.push(s) }
let aborted = 0
ALWAYS_ALLOWED.push('slow')
HANDLERS.slow = { label: 'A slow test job', run: async (_i, { signal }) => { await new Promise<void>(r => signal.addEventListener('abort', () => { aborted++; r() })); throw new Error('stopped') } }
const deps: Deps = {
  fetch: (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(init.body) : {}
    calls.push({ path: p, body })
    if (p === '/api/bridge/poll') {
      // A real server holds the request open when it has nothing; this one does too, until it is cancelled.
      if (!jobsToSend.length) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 400)
          init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
        })
        return new Response(JSON.stringify({ jobs: [], cancel: [] }))
      }
      const out = jobsToSend; jobsToSend = []
      return new Response(JSON.stringify({ jobs: out, cancel: [] }))
    }
    return new Response('{}')
  }) as any,
  sleep: async () => { await wait(5) },
  now: () => new Date(), log: l => logs.push(l), platform: () => 'windows', osRelease: () => 'Windows_NT 10.0', control
}
const cfg = { server: 'https://openlobs.example', deviceId: 'd1', token: 'olb_x', name: 'Desk', allow: [] as string[] }
const stop = new AbortController()
const loop = run(cfg, deps, stop.signal, undefined, 15)

jobsToSend = [{ id: 'j1', kind: 'slow', input: {} }]
await waitFor('the slow job to start', () => states.some(s => s.busy === 'A slow test job'))
assert(states.some(s => s.busy === 'A slow test job' && !s.paused), 'the status board says what the Bridge is doing')
pausedNow = true
await waitFor('the job to be stopped', () => aborted === 1)
await waitFor('the stop to be reported', () => calls.some(c => c.path.endsWith('/j1/result') && c.body.cancelled === true))
assert(aborted === 1 && logs.some(l => /Paused from the tray icon/.test(l)), 'pausing stops the running job at once and reports it as stopped')
await waitFor('the paused poll', () => calls.some(c => c.path === '/api/bridge/poll' && Array.isArray(c.body.capabilities) && c.body.capabilities.length === 0))
assert(true, 'while paused, the computer tells OpenLobs it can do nothing')
assert(states.at(-1)?.paused === true && states.some(s => s.paused), 'the status board shows paused')
jobsToSend = [{ id: 'j2', kind: 'ping', input: {} }]
await waitFor('the refused job', () => calls.some(c => c.path.endsWith('/j2/result')))
const refused = calls.find(c => c.path.endsWith('/j2/result'))!
assert(refused.body.ok === false && /paused/.test(refused.body.error) && !logs.some(l => /Running "ping"/.test(l)), 'a job that still arrives while paused is refused, even a ping')
pausedNow = false
calls.length = 0
await waitFor('the resumed poll', () => calls.some(c => c.path === '/api/bridge/poll' && c.body.capabilities?.includes('ping')))
assert(logs.some(l => /Resumed/.test(l)), 'resuming lets it work again')
quitNow = true
const ended = await Promise.race([loop, wait(3000).then(() => 'hung')])
assert(ended === 'stopped' && logs.some(l => /Quit from the tray icon/.test(l)) && states.at(-1)?.connected === false, 'quit ends the Bridge cleanly')
delete HANDLERS.slow

// ---- The tray script says what it does ----
assert(!/Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpListener|TcpListener|Net\.Sockets|Invoke-Expression|\biex\b|Start-Job|DownloadString/i.test(TRAY_SCRIPT), 'the tray script opens no port, makes no web request and runs no text as code')
assert(TRAY_SCRIPT.includes('TotalSeconds -gt 20') && TRAY_SCRIPT.includes("StartsWith('https://')"), 'the icon removes itself when the Bridge is gone, and opens only https or this computer')
assert((TRAY_SCRIPT.match(/Start-Process/g) ?? []).length === 2, 'it starts only two things: Notepad for the activity log, and the Computers page')
assert(process.platform === 'win32' || startTray(os.tmpdir()) === null, 'there is no tray icon outside Windows')

// ---- On Windows: the script is valid PowerShell and the icon really starts ----
if (process.platform === 'win32') {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'olb-tray-win-'))
  const script = path.join(work, 'tray.ps1')
  fs.writeFileSync(script, `﻿${TRAY_SCRIPT}`, 'utf8')
  const parse = await new Promise<string>(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message } } else { 'OK' }`], { encoding: 'utf8' }, (_e, out) => resolve(String(out).trim())))
  assert(parse === 'OK', `the tray script is valid PowerShell${parse === 'OK' ? '' : `: ${parse}`}`)
  fileControl(work).publish({ ...sample, at: new Date().toISOString() })
  const child = startTray(work)
  await wait(6000)
  const alive = !!child && child.exitCode === null
  // A build machine may have no desktop to put an icon on; a person's computer does. So this one is reported, not enforced.
  console.log(alive ? 'PASS the tray icon starts and stays up on this Windows machine' : 'NOTE the tray icon did not stay up here (a build machine may have no desktop session)')
  setPaused(work, true)
  child?.kill()
  fs.rmSync(work, { recursive: true, force: true })
}
