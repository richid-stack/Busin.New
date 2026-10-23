import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { BRIDGE_VERSION, PERMISSIONS, defaultDeps, disconnect, pair, run } from './core'
import type { Config } from './core'

/**
 * OpenLobs Bridge, command line.
 *   bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]
 *   bridge connect            (asks for the address and code)
 *   bridge run [--log FILE]
 *   bridge allow browser | bridge deny browser
 *   bridge status
 *   bridge disconnect
 */

const dir = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OpenLobsBridge') : path.join(os.homedir(), '.openlobs-bridge')
const file = path.join(dir, 'config.json')

function load(): Config | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Config } catch { return null }
}
function save(config: Config) {
  fs.mkdirSync(dir, { recursive: true })
  // The token is a password for this computer's link to OpenLobs. Owner-only where the system supports it.
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const [command, ...args] = process.argv.slice(2)

/** Output goes to the screen and, when asked, to a file that is kept small (a hidden background Bridge has no screen). */
const logPath = option(args, '--log') || process.env.OPENLOBS_BRIDGE_LOG
function log(line: string) {
  console.log(line)
  if (!logPath) return
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1_000_000) fs.renameSync(logPath, `${logPath}.1`)
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  } catch { /* logging must never stop the Bridge */ }
}
const deps = defaultDeps(log)

/** Only one Bridge runs per computer: a second one would just double the polling. */
const lockFile = path.join(dir, 'run.lock')
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'))
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); throw new Error('The Bridge is already running on this computer.') } catch (err: any) { if (err.message.startsWith('The Bridge')) throw err }
    }
  } catch (err: any) { if (err.message?.startsWith('The Bridge')) throw err }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(lockFile, String(process.pid))
}
const dropLock = () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.rmSync(lockFile, { force: true }) } catch { /* already gone */ } }

try {
  if (command === 'pair') {
    const code = args.find(a => !a.startsWith('--') && a !== option(args, '--server') && a !== option(args, '--name'))
    const server = option(args, '--server') || process.env.OPENLOBS_URL
    if (!code || !server) throw new Error('Usage: bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]')
    const config = await pair(server, code, option(args, '--name') || os.hostname().slice(0, 60), deps)
    save({ ...config, allow: load()?.allow })
    console.log(`Paired as "${config.name}". Run "bridge run" to connect.`)
  } else if (command === 'connect') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const server = (await rl.question('OpenLobs address (for example https://openlobs.example): ')).trim() || process.env.OPENLOBS_URL || ''
      const code = (await rl.question('Pairing code from the Computers page: ')).trim()
      if (!server || !code) throw new Error('An address and a code are both needed.')
      const config = await pair(server, code, os.hostname().slice(0, 60), deps)
      save({ ...config, allow: load()?.allow })
      console.log(`Paired as "${config.name}". It will connect the next time the Bridge starts (or at your next sign-in).`)
    } finally { rl.close() }
  } else if (command === 'run') {
    const config = load()
    if (!config) throw new Error('Not paired yet. Run "bridge pair" first.')
    takeLock()
    const stop = new AbortController()
    process.on('SIGINT', () => stop.abort())
    process.on('SIGTERM', () => stop.abort())
    process.on('exit', dropLock)
    const result = await run(config, deps, stop.signal, load)
    if (result === 'disconnected') { fs.rmSync(file, { force: true }); process.exitCode = 1 }
    else console.log('Stopped.')
  } else if (command === 'status') {
    const config = load()
    console.log(config ? `Bridge ${BRIDGE_VERSION}. Paired as "${config.name}" with ${config.server}.` : `Bridge ${BRIDGE_VERSION}. Not paired.`)
    if (config) {
      console.log('Allowed on this computer:')
      console.log('  - Answer a test ping (always)')
      for (const [name, p] of Object.entries(PERMISSIONS)) console.log(`  ${(config.allow ?? []).includes(name) ? '-' : 'x'} ${p.label}${(config.allow ?? []).includes(name) ? '' : `  (off; turn on with: bridge allow ${name})`}`)
    }
  } else if (command === 'allow' || command === 'deny') {
    const config = load()
    if (!config) throw new Error('Not paired yet. Run "bridge pair" first.')
    const name = args[0]
    if (!name || !Object.prototype.hasOwnProperty.call(PERMISSIONS, name)) throw new Error(`Usage: bridge ${command} <${Object.keys(PERMISSIONS).join('|')}>`)
    const set = new Set(config.allow ?? [])
    if (command === 'allow') set.add(name)
    else set.delete(name)
    save({ ...config, allow: [...set] })
    console.log(command === 'allow' ? `Allowed: ${PERMISSIONS[name]!.label}. A running Bridge picks this up within a minute.` : `No longer allowed: ${PERMISSIONS[name]!.label}.`)
  } else if (command === 'disconnect') {
    const config = load()
    if (!config) throw new Error('Not paired.')
    await disconnect(config, deps).catch(() => console.log('Could not reach OpenLobs; removing this computer\'s link locally. Disconnect it in OpenLobs too.'))
    fs.rmSync(file, { force: true })
    console.log('Disconnected.')
  } else {
    console.log(`OpenLobs Bridge ${BRIDGE_VERSION}\n  bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]\n  bridge connect\n  bridge run [--log FILE]\n  bridge allow browser | deny browser\n  bridge status\n  bridge disconnect`)
  }
} catch (err: any) {
  console.error(err.message)
  process.exitCode = 1
}
