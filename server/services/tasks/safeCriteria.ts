import { HTTPError } from 'nitro'
import { parseSafeUrl, UnsafeUrlError } from '../../utils/netSafety'
import type { TaskInput } from './model'

/** A web address to look at must be a public one; say so when the task or schedule is saved, not after it has run. */
export function assertSafeCriteria(input: Pick<TaskInput, 'criteria'>) {
  for (const c of input.criteria) {
    if (c.kind === 'visual') {
      try { parseSafeUrl(c.url!) } catch (e) { throw new HTTPError({ statusCode: 400, statusMessage: e instanceof UnsafeUrlError ? e.message : 'That is not a valid web address.' }) }
    }
  }
}
