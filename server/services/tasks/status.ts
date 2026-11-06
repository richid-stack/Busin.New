import type { Criterion } from './model'

/** How a task ended, from how each of its criteria came out. Kept apart from the store and the runner so both can use it. */
export function finalStatus(criteria: Criterion[]): { status: 'done' | 'needs_review' | 'partial' | 'failed', outcome: string } {
  const n = (s: Criterion['status']) => criteria.filter(c => c.status === s).length
  const met = n('met'); const unmet = n('unmet'); const open = n('unsure') + n('pending') + n('unchecked')
  const total = criteria.length
  if (unmet === 0 && open === 0) return { status: 'done', outcome: `Done. All ${total} ${total === 1 ? 'criterion was' : 'criteria were'} checked and met.` }
  if (unmet === 0) return { status: 'needs_review', outcome: `Finished, but ${open} of ${total} could not be checked automatically. Please review ${open === 1 ? 'it' : 'them'}.` }
  if (met > 0) return { status: 'partial', outcome: `Partly done: ${met} of ${total} met, ${unmet} not met${open ? `, ${open} could not be checked` : ''}.` }
  return { status: 'failed', outcome: `Not done: none of the ${total} ${total === 1 ? 'criterion was' : 'criteria were'} met.` }
}
