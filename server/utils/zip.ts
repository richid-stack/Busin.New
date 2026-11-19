import { inflateRawSync } from 'node:zlib'

/**
 * Reads one file out of a small .zip held in memory (what GitHub hands back for a build artifact).
 * It reads the central directory, supports "stored" and "deflated" entries, and refuses anything larger than `max` once unpacked.
 * It is not a general zip tool: no encryption, no zip64, no writing.
 */
export class ZipError extends Error {}

export function readZipEntry(zip: Buffer, match: (name: string) => boolean, max = 1_000_000): Buffer {
  // The end-of-directory record sits at the very end (a comment of up to 65535 bytes can follow it).
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new ZipError('That is not a zip file.')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new ZipError('The zip file is damaged.')
    const method = zip.readUInt16LE(at + 10)
    const packed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const noteLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    at += 46 + nameLen + extraLen + noteLen
    if (!match(name) || name.endsWith('/')) continue
    if (size > max) throw new ZipError('The file inside the zip is too large.')
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new ZipError('The zip file is damaged.')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    if (start + packed > zip.length) throw new ZipError('The zip file is damaged.')
    const data = zip.subarray(start, start + packed)
    if (method === 0) return Buffer.from(data)
    if (method === 8) {
      try { return inflateRawSync(data, { maxOutputLength: max }) } catch { throw new ZipError('The file inside the zip could not be unpacked.') }
    }
    throw new ZipError('The zip file uses a format that is not supported.')
  }
  throw new ZipError('The file was not in the zip.')
}
