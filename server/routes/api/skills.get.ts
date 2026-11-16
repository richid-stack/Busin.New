import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { listInstalledSkills, USER_SKILL_LIMITS } from '../../services/skills/userSkills'

/** The skills the person chose to keep. The body is left out: the page shows what it is and where it came from. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const skills = await listInstalledSkills(user.id)
  return {
    skills: skills.map(s => ({ name: s.name, description: s.description, source: s.source, warnings: s.warnings, installedAt: s.installedAt })),
    limits: { skills: USER_SKILL_LIMITS.maxPerUser }
  }
})
