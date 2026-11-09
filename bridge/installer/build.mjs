// Builds the Windows Bridge app folder that the installer packs up.
//   node bridge/installer/build.mjs --node path/to/node.exe     -> dist/bridge-app/
//   node bridge/installer/build.mjs --bundle-only out.mjs        -> just the one-file Bridge (used by tests)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

async function bundle(file) {
  const build = await rolldown({ input: path.join(root, 'bridge/cli.ts'), platform: 'node', external: ['playwright-core'], logLevel: 'warn' })
  await build.write({ file, format: 'esm' })
  await build.close()
}

const only = opt('--bundle-only')
if (only) {
  await bundle(path.resolve(only))
  process.exit(0)
}

const nodeExe = opt('--node')
if (!nodeExe || !fs.existsSync(nodeExe)) throw new Error('Pass --node <path to node.exe> (the Windows build of Node 22 to ship).')
const out = path.join(root, 'dist/bridge-app')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

await bundle(path.join(out, 'bridge.mjs'))
// Node is shipped under its own name so Task Manager shows what it is, and so removing it never touches another Node on the computer.
fs.copyFileSync(nodeExe, path.join(out, 'openlobs-bridge.exe'))
for (const f of fs.readdirSync(path.join(root, 'bridge/installer/files'))) fs.copyFileSync(path.join(root, 'bridge/installer/files', f), path.join(out, f))
// The only library the Bridge needs at run time. It talks to Edge or Chrome already on the computer, so no browser is shipped.
const pw = path.join(root, 'node_modules/playwright-core')
if (!fs.existsSync(pw)) throw new Error('playwright-core is not installed. Run npm ci first.')
fs.cpSync(pw, path.join(out, 'node_modules/playwright-core'), { recursive: true })
console.log(`Built ${out}`)
