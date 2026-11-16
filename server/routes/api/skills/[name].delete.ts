import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { removeInstalledSkill } from '../../../services/skills/userSkills'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'skills-write', user.id, 20, 10 * 60_000)
  const { name } = await getValidatedRouterParams(event, z.object({ name: z.string().min(1).max(64) }).parse)
  const removed = await removeInstalledSkill(user.id, name)
  if (!removed) throw new HTTPError({ statusCode: 404, statusMessage: 'Skill not found' })
  return { ok: true }
})
