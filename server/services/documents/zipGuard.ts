import { DocumentError } from './errors'

export interface ZipLimits {
  maxEntries: number
  maxTotalBytes: number
  maxEntryBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 3000, maxTotalBytes: 60 * 1024 * 1024, maxEntryBytes: 40 * 1024 * 1024 }

/**
 * A .docx is a zip file, and a tiny upload can unpack to gigabytes (a "zip bomb"). This reads only the
 * zip's index, without unpacking anything, and refuses files whose declared size is unreasonable.
 */
export function assertSafeZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bad = () => new DocumentError('The file is not a valid Word document.')

  // The end-of-central-directory record sits in the last 64 KB.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw bad()

  const entries = view.getUint16(eocd + 10, true)
  const dirSize = view.getUint32(eocd + 12, true)
  let offset = view.getUint32(eocd + 16, true)
  if (entries === 0xFFFF || dirSize === 0xFFFFFFFF || offset === 0xFFFFFFFF) {
    throw new DocumentError('This file uses a zip format that is not supported.')
  }
  if (entries > limits.maxEntries) throw new DocumentError('The document contains too many parts.')
  if (offset + dirSize > bytes.length) throw bad()

  let total = 0
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw bad()
    const size = view.getUint32(offset + 24, true)
    if (size > limits.maxEntryBytes) throw new DocumentError('The document is too large once unpacked.')
    total += size
    if (total > limits.maxTotalBytes) throw new DocumentError('The document is too large once unpacked.')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}
