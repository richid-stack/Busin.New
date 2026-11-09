import { execFile } from 'node:child_process'

/**
 * The only place the Bridge starts another program. It is used for one thing: the fixed scripts that drive a
 * spreadsheet program (see bridge/sheets/engine.ts). No text from OpenLobs ever becomes a program name, a
 * script or a command line: callers pass a known program and known script paths, and arguments go as a list,
 * never through a shell, so nothing in them can be read as a command.
 */
export interface RunResult { code: number, stdout: string, stderr: string, timedOut: boolean }

export function runProgram(exe: string, args: string[], opts: { timeoutMs: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(exe, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeoutMs, maxBuffer: 2_000_000, env: opts.env ?? process.env, signal: opts.signal }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean, code?: number | string }) | null
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: !!e?.killed })
    })
    child.on('error', () => { /* reported through the callback */ })
  })
}
