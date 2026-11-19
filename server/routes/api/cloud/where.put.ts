import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { setCloudWhere } from '../../../services/cloudbox/githubStore'
import { cloudOverview } from '../../../services/cloudbox/overview'

/** Where plans go: the person's own GitHub, or the OpenLobs box. Only a place that can work can be chosen. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'cloud-where', user.id, 30, 10 * 60_000)
  const { where } = await readValidatedBody(event, z.object({ where: z.enum(['github', 'box']) }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Choose your GitHub or the OpenLobs cloud box.' })
  })
  const db = getFirebaseDb()
  const now = await cloudOverview(db, user.id)
  if (where === 'github' && !now.github.connected) throw new HTTPError({ statusCode: 400, statusMessage: 'Set up your GitHub first.' })
  if (where === 'box' && !now.box) throw new HTTPError({ statusCode: 400, statusMessage: 'This app has no OpenLobs cloud box.' })
  await setCloudWhere(db, user.id, where)
  return await cloudOverview(db, user.id)
})
