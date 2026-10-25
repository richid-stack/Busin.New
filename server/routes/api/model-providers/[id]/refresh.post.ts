import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { open } from '../../../../utils/secretBox'
import { providerById } from '../../../../../shared/modelProviders'
import { ModelListError, fetchProviderModels } from '../../../../services/models/list'
import { KEY_PURPOSE } from '../../../../services/models/resolve'
import { getConnection, saveConnection } from '../../../../services/models/store'
import { viewConnection } from '../../../../services/models/view'

/** Asks the provider again with the saved key, so new models show up and retired ones go. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'model-connect', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(40) }).parse)
  const def = providerById(id)
  const connection = def ? await getConnection(user.id, id) : null
  if (!def || !connection) throw new HTTPError({ statusCode: 404, statusMessage: 'Connect this provider first.' })
  let apiKey: string
  try { apiKey = open(connection.sealedKey, KEY_PURPOSE) } catch { throw new HTTPError({ statusCode: 400, statusMessage: 'The saved key cannot be read. Connect again with the key.' }) }
  try {
    const models = await fetchProviderModels(def, { apiKey, baseUrl: connection.baseUrl })
    return viewConnection(await saveConnection(user.id, { providerId: id, baseUrl: connection.baseUrl, sealedKey: connection.sealedKey, models }))
  } catch (err) {
    if (err instanceof ModelListError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
