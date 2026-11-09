import { HTTPError } from 'nitro'
import type { H3Event } from 'nitro'
import { getHeader } from 'nitro/h3'
import { bridgeStore } from '../services/bridge/store'
import type { Device } from '../services/bridge/model'

/** Authenticates a Bridge by its device token. A revoked or unknown token is refused the same way. */
export async function requireDevice(event: H3Event): Promise<Device> {
  const token = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const device = token ? await bridgeStore().authenticate(token) : null
  if (!device) throw new HTTPError({ statusCode: 401, statusMessage: 'This computer is not connected. Pair it again from OpenLobs.' })
  return device
}
