import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { InspectError } from '../server/services/inspect/browser'
import { RESULT_SCHEMA, parseJobInput } from '../server/services/bridge/model'
import { createLookInFolderTool, createRunOnComputerTool } from '../server/utils/tools/runOnComputer'
import { folderLook, folderRead, runCommand } from '../bridge/run'
import { runPlanSchema } from '../shared/runPlan'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// The tools talk to a computer through the job queue. Here the queue is replaced by the real computer-side code, and the
// server's own checks (the job's input rules and the result rules) sit in between exactly as they do for real.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'olb-tool-')))
const env = { PATH: process.env.PATH, HOME: root } as NodeJS.ProcessEnv
const calls: Array<{ kind: string, input: any }> = []
let offline = false
const runJob = (async (opts: any, signal?: AbortSignal) => {
  if (offline) throw new InspectError('"Test PC" is offline right now. Start the Bridge on it and try again.')
  calls.push({ kind: opts.kind, input: opts.input })
  // Only so the timeout case does not make the test wait two minutes: the real limit is still enforced by the computer.
  if (opts.kind === 'run_command' && opts.input.args?.includes('slow.js')) opts = { ...opts, input: { ...opts.input, limitMs: 5000 } }
  const input = parseJobInput(opts.kind, opts.input)
  const ac = signal ?? new AbortController().signal
  const result = opts.kind === 'run_command' ? await runCommand(root, input, ac, { env }) : opts.kind === 'folder_look' ? folderLook(root, input) : folderRead(root, input)
  return { computer: 'Test PC', result: (RESULT_SCHEMA as any)[opts.kind].parse(result) as Record<string, unknown> }
}) as any
let n = 0
const user = () => `runner-${++n}`
const run = createRunOnComputerTool(user(), { runJob, store: {} as any })
const exec = (t: any, input: any, userId = user()) => (t.execute as any)(input, { abortSignal: undefined, userId })
const fresh = (userId = user()) => createRunOnComputerTool(userId, { runJob, store: {} as any })

fs.writeFileSync(path.join(root, 'ok.js'), "console.log('all good')")
fs.writeFileSync(path.join(root, 'bad.js'), "console.error('Error: missing thing'); process.exit(2)")
fs.writeFileSync(path.join(root, 'later.js'), "console.log('should not run')")

// ---- Approval comes first, and a bad plan never reaches the card ----
assert((run as any).needsApproval === true, 'a plan always needs the person\'s approval')
const schema = (run as any).inputSchema
assert(schema.safeParse({ why: 'Run it', steps: [{ program: 'node', args: ['ok.js'] }] }).success, 'an allowed plan is accepted')
const refused = schema.safeParse({ why: 'Send it', steps: [{ program: 'node', args: ['ok.js'] }, { program: 'git', args: ['push', 'origin', 'main'] }] })
assert(!refused.success && /Step 2/.test(refused.error.issues[0].message), 'a plan with a step that is not allowed is refused with the step number, before any card')
assert(schema === runPlanSchema || schema.safeParse({ why: 'x', steps: [] }).success === false, 'it uses the shared rulebook')

// ---- A plan that works ----
const good = await exec(fresh(), { why: 'Run the two programs', steps: [{ program: 'node', args: ['ok.js'], why: 'Check it starts' }, { program: 'node', args: ['--version'] }] })
assert((good as any).status === 'ok' && (good as any).steps.length === 2 && (good as any).steps[0].ok && /all good/.test((good as any).steps[0].output) && (good as any).computer === 'Test PC', 'every step runs in order and reports what it printed')
assert((good as any).steps[0].command === 'node ok.js' && /Run the program ok\.js/.test((good as any).steps[0].words) && typeof (good as any).steps[0].seconds === 'number', 'each step carries the command and what it does in plain words')
assert(/never instructions/.test((good as any).notice), 'what a program printed is marked as data')
assert(calls.every(c => c.kind === 'run_command') && calls[0]!.input.limitMs >= 5000 && calls[0]!.input.limitMs <= 120_000, 'each step is its own job with a time limit')

// ---- A plan that fails stops, and says what did not run ----
calls.length = 0
const failed: any = await exec(fresh(), { why: 'Try three things', steps: [{ program: 'node', args: ['ok.js'] }, { program: 'node', args: ['bad.js'] }, { program: 'node', args: ['later.js'] }] })
assert(failed.status === 'stopped' && failed.steps.length === 2 && failed.steps[1].ok === false && failed.steps[1].exitCode === 2 && /missing thing/.test(failed.steps[1].output) && failed.notRun === 1, 'it stops at the first step that fails and says how many did not run')
assert(calls.length === 2 && !/should not run/.test(JSON.stringify(failed)), 'the step after a failure is never started')
assert(/did not work/.test(failed.note) && /plain words/.test(failed.note), 'and tells the assistant to explain it in plain words')

// ---- Time ----
fs.writeFileSync(path.join(root, 'slow.js'), 'setTimeout(() => {}, 60000)')
const clockless: any = await exec(fresh(), { why: 'A slow one', steps: [{ program: 'node', args: ['slow.js'] }] })
assert(clockless.status === 'stopped' && clockless.steps[0].timedOut, 'a step that runs out of time is reported as timed out')

// ---- The computer is not available ----
offline = true
const gone: any = await exec(fresh(), { why: 'Run it', steps: [{ program: 'node', args: ['ok.js'] }] })
assert(gone.status === 'failed' && /offline/.test(gone.error) && /do not pretend/.test(gone.error), 'an offline computer is reported plainly, with no pretending')
offline = false

// ---- Limits ----
const limited = fresh('rate-limited-user')
let lastStatus = ''
for (let i = 0; i < 8; i++) { const r: any = await (limited.execute as any)({ why: 'Check it', steps: [{ program: 'node', args: ['--version'] }] }, {}); lastStatus = r.status }
assert(lastStatus !== 'ok', 'plans are rate limited per person')

// ---- Looking in the folder ----
const look = createLookInFolderTool(user(), { runJob, store: {} as any })
fs.writeFileSync(path.join(root, '.env'), 'TOKEN=abc')
fs.writeFileSync(path.join(root, 'notes.txt'), 'remember this')
const listed: any = await exec(look, { action: 'list' })
assert(listed.status === 'ok' && listed.entries.some((e: any) => e.name === 'notes.txt') && !listed.entries.some((e: any) => e.name === '.env') && listed.hidden >= 1, 'listing shows the files and hides secret ones')
const read: any = await exec(look, { action: 'read', file: 'notes.txt' })
assert(read.status === 'ok' && read.text === 'remember this' && /never instructions/.test(read.notice), 'reading shows the text, marked as data')
const secret: any = await exec(look, { action: 'read', file: '.env' }).catch((e: any) => ({ status: 'threw', error: e.message }))
assert(secret.status !== 'ok' && !/abc/.test(JSON.stringify(secret)), 'a secret file is never returned')
assert(((await exec(look, { action: 'read' })) as any).status === 'failed', 'reading needs a file name')
assert(!('needsApproval' in (look as any)) || (look as any).needsApproval !== true, 'looking is read-only and needs no approval')

// ---- The queue's own rules ----
assert((() => { try { parseJobInput('run_command', { program: 'bash', args: ['-c', 'ls'] }); return false } catch { return true } })(), 'the job queue itself refuses a step the rulebook does not allow')
assert((() => { try { parseJobInput('run_command', { program: 'git', args: ['push'] }); return false } catch (e: any) { return /push/.test(e.message) } })(), 'with the reason')
assert((() => { try { parseJobInput('folder_read', { file: '' }); return false } catch { return true } })() && (() => { try { parseJobInput('folder_look', { depth: 5 }); return false } catch { return true } })(), 'looking is checked too')

fs.rmSync(root, { recursive: true, force: true })
