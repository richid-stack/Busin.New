import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { collectUserData, defaultAccountDeps } from '../../../services/account/account'

/** Everything the person has in OpenLobs, as one JSON file. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'account-export', user.id, 3, 10 * 60_000)
  const data = await collectUserData(defaultAccountDeps(), user)
  event.res.headers.set('Content-Disposition', `attachment; filename="openlobs-export-${data.exportedAt.slice(0, 10)}.json"`)
  event.res.headers.set('Cache-Control', 'no-store')
  return data
})
