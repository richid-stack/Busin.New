import { specialistById } from '../../shared/specialists'
import type { Specialist } from '../../shared/specialists'

const nameOf = (part: any): string => (part?.type === 'dynamic-tool' ? String(part.toolName || '') : typeof part?.type === 'string' && part.type.startsWith('tool-') ? part.type.slice(5) : '')

/**
 * Which specialist each step of a reply belongs to, so the chat can say plainly who is working. The handoff row belongs
 * to the lead (it is the lead asking); every step after it, up to and including the report, belongs to the specialist.
 * `active` is who is still working at the end of the reply, null once they have reported back.
 */
export function specialistLanes(parts: any[]): { lanes: Array<Specialist | null>, active: Specialist | null } {
  let active: Specialist | null = null
  const lanes = parts.map((p): Specialist | null => {
    const name = nameOf(p)
    if (name === 'hand_to_specialist') {
      const s = specialistById(p?.output?.specialist ?? p?.input?.specialist)
      const refused = p?.state === 'output-error' || p?.state === 'output-denied' || p?.output?.status === 'failed'
      if (s && !active && !refused) active = s
      return null
    }
    if (name === 'report_back') {
      const was = active
      active = null
      return was
    }
    return active
  })
  return { lanes, active }
}
