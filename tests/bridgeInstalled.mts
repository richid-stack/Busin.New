import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { startBridgeTestServer, waitFor } from './helpers/bridgeTestServer.mts'

/**
 * Windows only. Takes the built installer and does what a person would: install it, let it connect, use it,
 * uninstall it. Run by .github/workflows/bridge-windows.yml on a real Windows machine.
 *   npx tsx tests/bridgeInstalled.mts dist/OpenLobs-Bridge-Setup.exe
 */
const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
if (process.platform !== 'win32') { console.log('SKIP the installer check (Windows only)'); process.exit(0) }
const installer = path.resolve(process.argv[2] || 'dist/OpenLobs-Bridge-Setup.exe')
if (!fs.existsSync(installer)) throw new Error(`No installer at ${installer}`)

const run = (file: string, args: string[]) => new Promise<{ code: number, out: string }>(resolve =>
  execFile(file, args, { encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? Number((err as any).code) || 1 : 0, out: `${stdout}${stderr}` })))
// A .cmd file cannot be started directly any more; it goes through cmd.exe, with the quoting cmd expects for a path with spaces.
const runCmd = (file: string, args: string[]) => new Promise<{ code: number, out: string }>(resolve =>
  execFile('cmd.exe', ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }, (err, stdout, stderr) => resolve({ code: err ? Number((err as any).code) || 1 : 0, out: `${stdout}${stderr}` })))
const tasks = async () => (await run('tasklist', ['/FI', 'IMAGENAME eq openlobs-bridge.exe', '/FO', 'CSV', '/NH'])).out
const appDir = path.join(process.env.LOCALAPPDATA!, 'Programs', 'OpenLobs Bridge')
const startup = path.join(process.env.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'OpenLobs Bridge.lnk')
const menu = path.join(process.env.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'OpenLobs Bridge')
const dataDir = path.join(process.env.APPDATA!, 'OpenLobsBridge')

const server = await startBridgeTestServer()
try {
  const pairing = await server.store.createPairing('winuser')
  const log = path.join(process.env.RUNNER_TEMP || process.env.TEMP || '.', 'bridge-setup.log')
  const install = await run(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`, `/SERVER=${server.url}`, `/CODE=${pairing.code}`, '/ALLOWBROWSER=1'])
  if (install.code !== 0 && fs.existsSync(log)) console.log(fs.readFileSync(log, 'utf8').slice(-3000))
  assert(install.code === 0, 'the installer runs silently and finishes')

  for (const f of ['openlobs-bridge.exe', 'bridge.mjs', 'bridge.cmd', 'bridge-hidden.vbs', 'unins000.exe', path.join('node_modules', 'playwright-core', 'package.json')]) {
    assert(fs.existsSync(path.join(appDir, f)), `installed: ${f}`)
  }
  assert(fs.existsSync(startup), 'it starts when you sign in to Windows')
  assert(fs.existsSync(path.join(menu, 'Bridge status.lnk')) && fs.existsSync(path.join(menu, 'Connect to OpenLobs.lnk')), 'Start menu shortcuts exist')

  await waitFor('the installed Bridge to connect and report what is allowed', async () => {
    const d = (await server.store.listDevices('winuser'))[0]
    return !!d && d.capabilities.includes('browser_look')
  }, 60_000)
  assert(true, 'the installed Bridge paired with the code and is running')
  assert((await tasks()).includes('openlobs-bridge.exe'), 'it runs as openlobs-bridge.exe, named for what it is')
  const dev = (await server.store.listDevices('winuser'))[0]!

  const ping = await server.store.enqueue('winuser', dev.id, 'ping')
  await waitFor('ping', async () => (await server.store.getJob('winuser', ping.id)).status === 'done')
  assert(String(((await server.store.getJob('winuser', ping.id)).result as any).osVersion).includes('Windows'), 'it answers a ping from Windows')

  const look = await server.store.enqueue('winuser', dev.id, 'browser_look', { url: `${server.url}/page`, width: 640, height: 400 })
  await waitFor('browser look', async () => ['done', 'failed'].includes((await server.store.getJob('winuser', look.id)).status), 90_000)
  const done = await server.store.getJob('winuser', look.id)
  assert(done.status === 'done', `the installed Bridge looks at a page with the browser on this computer${done.status === 'done' ? '' : `: ${done.error}`}`)
  if (done.status === 'done') {
    const file = await server.files.get(done.fileId!, 'winuser')
    assert(file?.bytes[0] === 0xFF && (done.result as any).title === 'Installer Test Page' && (done.result as any).consoleErrors.some((e: string) => /test console error/.test(e)), 'the picture is a real screenshot and the page error was seen')
  }

  const status = await runCmd(path.join(appDir, 'bridge.cmd'), ['status'])
  assert(/Paired as/.test(status.out) && /Look at web pages/.test(status.out), 'the Start menu "status" command works')
  assert(fs.existsSync(path.join(dataDir, 'bridge.log')) && /Running "ping"/.test(fs.readFileSync(path.join(dataDir, 'bridge.log'), 'utf8')), 'it keeps an activity log')

  // Spreadsheets: choose a folder, then ask the installed Bridge to change a workbook with a real spreadsheet program.
  const sheetDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || process.env.TEMP || '.', 'olb-sheets-'))
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Sales').addRows([['Region', 'Units', 'Price'], ['North', 10, 2.5], ['South', 4, 3], ['North', 6, 2.5], ['East', 8, 4]])
  await wb.xlsx.writeFile(path.join(sheetDir, 'Sales.xlsx'))
  const allowed = await runCmd(path.join(appDir, 'bridge.cmd'), ['allow', 'excel', '--folder', `"${sheetDir}"`])
  assert(/Allowed:/.test(allowed.out), `the person can allow spreadsheet work in one folder${/Allowed:/.test(allowed.out) ? '' : `: ${allowed.out}`}`)
  await waitFor('the Bridge to report spreadsheet work', async () => (await server.store.listDevices('winuser'))[0]!.capabilities.includes('workbook_apply'), 60_000)
  const sheetJob = await server.store.enqueue('winuser', dev.id, 'workbook_apply', {
    file: 'Sales.xlsx',
    ops: [
      { op: 'fill_formula', sheet: 'Sales', column: 'D', fromRow: 2, toRow: 5, formula: '=B{row}*C{row}', header: 'Revenue' },
      { op: 'summarize', source: 'Sales', groupBy: 'A', value: 'D', fn: 'sum', headerRow: 1, target: 'By region' },
      { op: 'add_chart', sheet: 'By region', type: 'column', categories: 'A2:A4', values: 'B2:B4', title: 'Revenue by region' }
    ],
    pdf: true
  })
  await waitFor('the workbook job', async () => ['done', 'failed'].includes((await server.store.getJob('winuser', sheetJob.id)).status), 150_000)
  const sheetDone = await server.store.getJob('winuser', sheetJob.id)
  const sheetResult = sheetDone.result as any
  assert(sheetDone.status === 'done' && sheetResult.charts === 1 && sheetResult.checks.every((c: any) => c.ok), `the installed Bridge changes a workbook with ${sheetResult?.engine ?? 'a spreadsheet program'}${sheetDone.status === 'done' ? '' : `: ${sheetDone.error}`}`)
  assert(fs.existsSync(path.join(sheetDir, 'Sales (OpenLobs).xlsx')) && fs.existsSync(path.join(sheetDir, 'Sales (OpenLobs).pdf')), 'the new workbook and its PDF are in the chosen folder, and the original is still there')
  const selftest = await runCmd(path.join(appDir, 'bridge.cmd'), ['selftest'])
  assert(/Everything works/.test(selftest.out), `the Start menu spreadsheet check passes${/Everything works/.test(selftest.out) ? '' : `: ${selftest.out.slice(-600)}`}`)

  const un = await run(path.join(appDir, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'])
  assert(un.code === 0, 'the uninstaller runs silently')
  await waitFor('the computer to be forgotten by OpenLobs', async () => (await server.store.listDevices('winuser')).length === 0, 30_000)
  assert(true, 'uninstalling disconnects the computer in OpenLobs')
  await waitFor('everything to be gone', async () => !fs.existsSync(path.join(appDir, 'bridge.mjs')) && !fs.existsSync(startup), 30_000)
  assert(!(await tasks()).includes('openlobs-bridge.exe'), 'nothing is left running')
  assert(!fs.existsSync(startup) && !fs.existsSync(dataDir), 'the startup entry and its saved settings are removed')
} catch (e: any) {
  console.log('FAIL', e.message)
  process.exitCode = 1
} finally {
  await server.stop()
}
