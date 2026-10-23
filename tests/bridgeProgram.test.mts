import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findEngine } from '../bridge/sheets/engine'
import { startBridgeTestServer, waitFor } from './helpers/bridgeTestServer.mts'

/**
 * The built Bridge, as a separate program: bundle it the way the installer does, then pair it, allow it, run it,
 * ask it for jobs, and check what it does. Uses a real HTTP server with the app's real endpoint logic.
 */
const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const root = path.resolve(import.meta.dirname, '..')
// Inside the repository (dist is not committed) so the bundle finds playwright-core the way the installed app finds its own copy.
fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
const work = fs.mkdtempSync(path.join(root, 'dist', 'olb-prog-'))
const bundle = path.join(work, 'bridge.mjs')
execFileSync('node', [path.join(root, 'bridge/installer/build.mjs'), '--bundle-only', bundle], { cwd: root, stdio: 'pipe' })
assert(fs.existsSync(bundle) && fs.statSync(bundle).size > 5000 && fs.statSync(bundle).size < 3_000_000, 'the Bridge bundles into one file')
assert(!/^\s*(import|export)[^;\n]*from ['"]\.\.?\//m.test(fs.readFileSync(bundle, 'utf8')), 'the bundle has no other local files to find')

// Run it with its own home so it never touches a real configuration.
const home = path.join(work, 'home')
fs.mkdirSync(home)
const chromium = process.env.OPENLOBS_BROWSER_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: home, HOME: home, USERPROFILE: home, OPENLOBS_BRIDGE_LOG: '', ...(chromium ? { OPENLOBS_BROWSER_PATH: chromium } : {}) }
// Asynchronous on purpose: the stand-in server lives in this process and must be free to answer while the Bridge runs.
const bridge = (...args: string[]) => new Promise<string>((resolve, reject) => execFile('node', [bundle, ...args], { env, encoding: 'utf8' }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout))))
const fails = async (...args: string[]) => { try { await bridge(...args); return '' } catch (e: any) { return String(e.stderr || e.message) } }

const server = await startBridgeTestServer()
let child: ReturnType<typeof spawn> | null = null
try {
  assert(/Not paired/.test(await bridge('status')), 'a fresh Bridge says it is not paired')
  assert(/Usage/.test(await fails('pair', 'ABCD2345')), 'pairing needs an address')
  assert(/https/.test(await fails('pair', 'ABCD2345', '--server', 'http://example.com')), 'a plain-http server that is not this computer is refused')
  assert(/not valid or has expired/.test(await fails('pair', 'ZZZZ2222', '--server', server.url)), 'a wrong code is explained')

  const pairing = await server.store.createPairing('tester')
  assert(/Paired as/.test(await bridge('pair', pairing.code, '--server', server.url, '--name', 'Test PC')), 'the program pairs with a real code')
  const cfgFile = [path.join(home, 'OpenLobsBridge', 'config.json'), path.join(home, '.openlobs-bridge', 'config.json')].find(f => fs.existsSync(f))!
  assert(!!cfgFile && JSON.parse(fs.readFileSync(cfgFile, 'utf8')).token.startsWith('olb_'), 'the token is saved on this computer')
  assert(/Test PC/.test(await bridge('status')) && /x .*Look at web pages/.test(await bridge('status')), 'status shows the browser permission is off')
  assert(/Allowed:/.test(await bridge('allow', 'browser')) && /- .*Look at web pages/.test(await bridge('status')), 'allow browser turns the permission on')
  assert(/Usage/.test(await fails('allow', 'shell')) && /Usage/.test(await fails('allow', '__proto__')), 'only known permissions can be allowed')

  const log = path.join(work, 'bridge.log')
  child = spawn('node', [bundle, 'run', '--log', log], { env, stdio: 'ignore' })
  const devices = await server.store.listDevices('tester')
  const dev = devices[0]!
  await waitFor('the Bridge to report in with its permissions', async () => (await server.store.getDevice('tester', dev.id)).capabilities.includes('browser_look'))
  assert(true, 'a running Bridge tells the server what is allowed')

  const ping = await server.store.enqueue('tester', dev.id, 'ping')
  await waitFor('ping', async () => (await server.store.getJob('tester', ping.id)).status === 'done')
  assert((((await server.store.getJob('tester', ping.id)).result) as any).bridgeVersion === '0.4.0', 'the program answers a ping')

  const look = await server.store.enqueue('tester', dev.id, 'browser_look', { url: `${server.url}/page`, width: 500, height: 340 })
  await waitFor('browser look', async () => ['done', 'failed'].includes((await server.store.getJob('tester', look.id)).status), 60_000)
  const done = await server.store.getJob('tester', look.id)
  if (done.status === 'done') {
    const file = await server.files.get(done.fileId!, 'tester')
    assert(file?.bytes[0] === 0xFF && (done.result as any).title === 'Installer Test Page' && (done.result as any).consoleErrors.some((e: string) => /test console error/.test(e)), 'the program looks at a page with a real browser and uploads the picture')
  } else if (/Neither Microsoft Edge nor Google Chrome|not installed/.test(done.error)) console.log('SKIP the browser look from the bundled program (no browser on this machine):', done.error)
  else assert(false, `the browser look failed: ${done.error}`)

  assert(fs.existsSync(log) && /Running "ping"/.test(fs.readFileSync(log, 'utf8')), 'it writes what it does to a log file')
  assert(/already running/.test(await fails('run')), 'a second Bridge on the same computer is refused')

  // Turning the permission off is noticed by the running Bridge.
  await bridge('deny', 'browser')
  await waitFor('the permission to be withdrawn', async () => !(await server.store.getDevice('tester', dev.id)).capabilities.includes('browser_look'), 20_000)
  assert(true, 'a running Bridge notices when the owner turns a permission off')

  // The bundled program can do spreadsheet work with a real spreadsheet program, when this machine has one.
  if (await findEngine()) {
    const out = await bridge('selftest')
    assert(/Everything works/.test(out), 'the bundled program passes its own spreadsheet check (real LibreOffice)')
  } else console.log('SKIP the spreadsheet check (no LibreOffice here)')

  assert(/Disconnected/.test(await bridge('disconnect')) && !fs.existsSync(cfgFile), 'disconnect removes the pairing here')
  assert((await server.store.listDevices('tester')).length === 0, 'and OpenLobs forgets the computer')
} finally {
  child?.kill()
  await server.stop()
  fs.rmSync(work, { recursive: true, force: true })
}
