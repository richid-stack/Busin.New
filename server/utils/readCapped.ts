/**
 * Reads a request body but stops as soon as it is larger than `max` bytes, so a very large upload is dropped
 * after a few megabytes instead of being held in memory first. A Content-Length header can be missing or wrong
 * (chunked uploads have none), so the real size is counted as the bytes arrive. Returns null when it is too large.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.byteLength }
  return out
}
