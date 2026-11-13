/**
 * Line by line comparison of two versions of a text file, for the "what changed" view and for the "+5 −1" counts.
 * Small on purpose: the common start and end are trimmed first, and only the middle is compared.
 */
export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
  /** Line number in the older version (not on added lines). */
  oldNo?: number
  /** Line number in the newer version (not on removed lines). */
  newNo?: number
}

export interface Diff {
  lines: DiffLine[]
  added: number
  removed: number
}

/** The middle can be at most this many lines on each side. Past that, the whole middle counts as replaced. */
const MAX_MIDDLE = 1500

/** The lines of a text. A newline at the very end ends the last line; it does not start another one. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function diffLines(before: string, after: string): Diff {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i]!, oldNo: i + 1, newNo: i + 1 })

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  let added = 0
  let removed = 0
  const del = (i: number) => { out.push({ kind: 'del', text: a[start + i]!, oldNo: start + i + 1 }); removed++ }
  const add = (j: number) => { out.push({ kind: 'add', text: b[start + j]!, newNo: start + j + 1 }); added++ }

  if (midA.length > MAX_MIDDLE || midB.length > MAX_MIDDLE) {
    midA.forEach((_, i) => del(i))
    midB.forEach((_, j) => add(j))
  } else {
    // Longest common subsequence of the middle. Tables are small because of the cap above.
    const n = midA.length
    const m = midB.length
    const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { out.push({ kind: 'same', text: midA[i]!, oldNo: start + i + 1, newNo: start + j + 1 }); i++; j++ }
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) del(i++)
      else add(j++)
    }
    while (i < n) del(i++)
    while (j < m) add(j++)
  }

  for (let k = 0; k < a.length - endA; k++) out.push({ kind: 'same', text: a[endA + k]!, oldNo: endA + k + 1, newNo: endB + k + 1 })
  return { lines: out, added, removed }
}

/** Just the counts, for "+5 −1". */
export function countChanges(before: string, after: string): { added: number, removed: number } {
  const { added, removed } = diffLines(before, after)
  return { added, removed }
}
