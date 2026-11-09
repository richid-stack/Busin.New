import { defineHandler, HTTPError } from 'nitro'
import { readBody } from 'nitro/h3'
import { enforceRateLimit, clientAddress } from '../../../utils/rateLimit'
import { ApiError, pairDevice } from '../../../services/bridge/api'
import { bridgeStore } from '../../../services/bridge/store'

/** The Bridge trades its code for a device token. The code is the only credential here, so guesses are rate limited hard. */
export default defineHandler(async (event) => {
  enforceRateLimit(event, 'bridge-pair', clientAddress(event), 10, 10 * 60_000)
  const body = await readBody(event).catch(() => null)
  try {
    return await pairDevice(bridgeStore(), body)
  } catch (err) {
    if (err instanceof ApiError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
