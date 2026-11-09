import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { ModelConnectionError, setSelection } from '../../../../services/models/store'
import { viewConnection } from '../../../../services/models/view'

const modelId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/, 'A model name can use letters, digits and . _ : / @ + -')
const body = z.object({ enabled: z.array(modelId).max(200), manual: z.array(modelId).max(50).optional().default([]) })

/** Which of the provider's models appear in the picker. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(40) }).parse)
  const input = await readValidatedBody(event, b => body.parse(b))
  try {
    return viewConnection(await setSelection(user.id, id, input))
  } catch (err) {
    if (err instanceof ModelConnectionError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
