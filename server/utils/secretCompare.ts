import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

/** Compares two secrets in constant time; hashing first means the lengths do not leak either. */
export function secretMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected))
}
