import { reefHandler } from '../../../../utils/reefRoute'

/** Reported things waiting for a person to look. Only the people in REEF_ADMINS. */
export default reefHandler({ auth: 'admin' }, async ({ reef }) => ({ items: await reef.moderation.queue() }))
