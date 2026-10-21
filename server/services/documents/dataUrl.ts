import { DocumentError } from './errors'

/**
 * Decodes a `data:` URL. Attachments arrive from the browser in this form, and only this form is
 * accepted: an http(s) address in a file part would make the server fetch whatever the caller names.
 */
export function parseDataUrl(url: string, maxBytes: number): { mediaType: string, bytes: Uint8Array } {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(url)
  if (!match) throw new DocumentError('The attachment is not an uploaded file.')

  const isBase64 = /;base64$/i.test(match[2] ?? '')
  const payload = url.slice(match[0].length)
  // Cheap size check before decoding anything.
  const estimated = isBase64 ? Math.floor(payload.length * 3 / 4) : payload.length
  if (estimated > maxBytes) throw new DocumentError(`The file is larger than ${Math.round(maxBytes / 1024)} KB.`)

  try {
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(payload, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(payload))
    return { mediaType: (match[1] || 'text/plain').toLowerCase(), bytes }
  } catch {
    throw new DocumentError('The attachment could not be decoded.')
  }
}
