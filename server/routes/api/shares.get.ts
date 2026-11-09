import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { publicShare, shareStore } from '../../services/reef/share'

/** The links this person has made. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return (await shareStore().listMine(user.id)).map(s => ({ ...publicShare(s), agentId: s.agentId }))
})
