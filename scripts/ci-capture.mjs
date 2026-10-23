// Runs a command and, if it fails, copies the end of its output into a GitHub annotation, so the reason is
// visible from the pull request without opening the raw log.  Usage: node scripts/ci-capture.mjs "label" command args...
import { spawn } from 'node:child_process'

const [label, cmd, ...args] = process.argv.slice(2)
const child = spawn(cmd, args, { shell: process.platform === 'win32', env: process.env })
let out = ''
const take = (d) => { const s = d.toString(); process.stdout.write(s); out += s; if (out.length > 200_000) out = out.slice(-100_000) }
child.stdout.on('data', take)
child.stderr.on('data', take)
child.on('close', (code) => {
  const bad = out.split(/\r?\n/).filter(l => /^FAIL|Error|error TS|Timed out/.test(l)).slice(0, 15)
  if (code !== 0 || bad.length) {
    const tail = out.slice(-5500).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
    console.log(`::error title=${label} (exit ${code})::${tail}`)
  }
  process.exit(code ?? 1)
})
