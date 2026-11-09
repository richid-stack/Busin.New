import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { seal } from '../../../../utils/secretBox'
import { providerById } from '../../../../../shared/modelProviders'
import { ModelListError, fetchProviderModels } from '../../../../services/models/list'
import { KEY_PURPOSE, checkBaseUrl } from '../../../../services/models/resolve'
import { ModelConnectionError, saveConnection } from '../../../../services/models/store'
import { viewConnection } from '../../../../services/models/view'

const body = z.object({
  key: z.string().transform(k => k.replace(/[\u0000-\u001F\u007F\s]/g, '')).pipe(z.string().min(8, 'That key looks too short.').max(500, 'That key is too long.')),
  baseUrl: z.string().max(300).optional().default('')
})

/**
 * Checks the key by asking the provider for its models, and only then saves it (sealed) with the list.
 * A key that does not work is never stored.
 */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'model-connect', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(40) }).parse)
  const def = providerById(id)
  if (!def) throw new HTTPError({ statusCode: 404, statusMessage: 'Unknown provider.' })
  const input = await readValidatedBody(event, b => body.parse(b))

  const typed = input.baseUrl.trim()
  if (def.custom && !typed) throw new HTTPError({ statusCode: 400, statusMessage: 'Add the service’s address.' })
  const baseUrl = typed ? checkBaseUrl(typed) : ''

  try {
    const models = await fetchProviderModels(def, { apiKey: input.key, baseUrl })
    const saved = await saveConnection(user.id, { providerId: id, baseUrl: baseUrl === def.baseUrl ? '' : baseUrl, sealedKey: seal(input.key, KEY_PURPOSE), models })
    return viewConnection(saved)
  } catch (err) {
    if (err instanceof ModelListError || err instanceof ModelConnectionError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
