import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BRIDGE_VERSION, defaultDeps, disconnect, pair, run } from './core'
import type { Config } from './core'

/**
 * OpenLobs Bridge, command line.
 *   bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]
 *   bridge run
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

const deps = defaultDeps()
const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'pair') {
    const code = args.find(a => !a.startsWith('--') && a !== option(args, '--server') && a !== option(args, '--name'))
    const server = option(args, '--server') || process.env.OPENLOBS_URL
    if (!code || !server) throw new Error('Usage: bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]')
    const config = await pair(server, code, option(args, '--name') || os.hostname().slice(0, 60), deps)
    save(config)
    console.log(`Paired as "${config.name}". Run "bridge run" to connect.`)
  } else if (command === 'run') {
    const config = load()
    if (!config) throw new Error('Not paired yet. Run "bridge pair" first.')
    const stop = new AbortController()
    process.on('SIGINT', () => stop.abort())
    process.on('SIGTERM', () => stop.abort())
    const result = await run(config, deps, stop.signal)
    if (result === 'disconnected') { fs.rmSync(file, { force: true }); process.exitCode = 1 }
    else console.log('Stopped.')
  } else if (command === 'status') {
    const config = load()
    console.log(config ? `Bridge ${BRIDGE_VERSION}. Paired as "${config.name}" with ${config.server}.` : `Bridge ${BRIDGE_VERSION}. Not paired.`)
  } else if (command === 'disconnect') {
    const config = load()
    if (!config) throw new Error('Not paired.')
    await disconnect(config, deps).catch(() => console.log('Could not reach OpenLobs; removing this computer\'s link locally. Disconnect it in OpenLobs too.'))
    fs.rmSync(file, { force: true })
    console.log('Disconnected.')
  } else {
    console.log(`OpenLobs Bridge ${BRIDGE_VERSION}\n  bridge pair <CODE> --server https://your-openlobs [--name "My laptop"]\n  bridge run\n  bridge status\n  bridge disconnect`)
  }
} catch (err: any) {
  console.error(err.message)
  process.exitCode = 1
}
