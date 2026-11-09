/**
 * Turns "a job that reports progress through a callback" into something that can be streamed: every report
 * comes out as it happens (only the newest if several arrive at once), then the finished result.
 */
export async function* withProgress<P, R>(job: (report: (progress: P) => void) => Promise<R>): AsyncGenerator<{ progress: P } | { result: R }> {
  let latest: { value: P } | null = null
  let wake: (() => void) | null = null
  let finished = false
  const run = job((value) => { latest = { value }; wake?.() }).finally(() => { finished = true; wake?.() })
  // A failed job must not leave a loose rejection while the loop is waiting.
  run.catch(() => {})
  while (!finished) {
    await new Promise<void>((resolve) => { wake = resolve; if (latest || finished) resolve() })
    if (latest) {
      const { value } = latest
      latest = null
      yield { progress: value }
    }
  }
  yield { result: await run }
}
