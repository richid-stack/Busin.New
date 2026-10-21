import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getUsage } from '../../../services/usage/usage'

/** The signed-in person's plan and how much they have used today and this month. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return await getUsage(user.id)
})
