import { reefHandler } from '../../../utils/reefRoute'

export default reefHandler({ auth: 'required' }, async ({ me, reef }) => ({ items: await reef.alerts.list(me.id) }))
