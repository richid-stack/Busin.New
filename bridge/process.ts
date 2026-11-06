import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

export type { ChildProcess }

/**
 * The only place the Bridge starts another program. It is used for one thing: the fixed scripts that drive a
 * spreadsheet program (see bridge/sheets/engine.ts). No text from OpenLobs ever becomes a program name, a
 * script or a command line: callers pass a known program and known script paths, and arguments go as a list,
 * never through a shell, so nothing in them can be read as a command.
 */
export interface RunResult { code: number, stdout: string, stderr: string, timedOut: boolean }

export function runProgram(exe: string, args: string[], opts: { timeoutMs: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false
    const cap = (text: string, more: Buffer) => (text.length < 2_000_000 ? text + more.toString('utf8') : text)
    // Its own process group on Linux and macOS, so everything it starts can be stopped with it.
    const child = spawn(exe, args, { windowsHide: true, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    child.stdout?.on('data', (d: Buffer) => { stdout = cap(stdout, d) })
    child.stderr?.on('data', (d: Buffer) => { stderr = cap(stderr, d) })
    const stop = () => killTree(child)
    const timer = setTimeout(() => { timedOut = true; stop() }, opts.timeoutMs)
    const onAbort = () => stop()
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (code: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut })
    }
    child.on('error', () => finish(1))
    child.on('close', (code, signal) => finish(typeof code === 'number' ? code : signal ? 1 : 0))
  })
}

/** Stops a program and everything it started: a spreadsheet program started by a script does not end when the script is killed. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      const k = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      k.on('error', () => { try { child.kill() } catch { /* already gone */ } })
    } else {
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
  } catch { /* already gone */ }
}

/** Starts a fixed program that keeps running next to the Bridge (the tray icon). The caller stops it when the Bridge stops. */
export function startBackground(exe: string, args: string[]): ChildProcess {
  return spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
}
