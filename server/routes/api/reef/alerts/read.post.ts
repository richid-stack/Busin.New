import { reefHandler, WRITE } from '../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-alerts', 60, 60_000) }, async ({ me, reef }) => {
  await reef.alerts.markAllRead(me.id)
  return { success: true }
})
