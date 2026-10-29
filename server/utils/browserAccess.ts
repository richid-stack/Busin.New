import type { H3Event } from 'nitro'
import { createError, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { getChat } from './firebase'
import { enforceRateLimit } from './rateLimit'
import { requireUser } from './session'
import { BrowserError } from '../services/browser/model'
import { browserKey, defaultBrowserService, type BrowserService } from '../services/browser/service'

const STATUS: Record<string, number> = { bad_input: 400, unsafe: 400, not_found: 404, limit: 429, failed: 502 }

/**
 * Everything a browser route needs: a signed-in person who owns this chat, the browser service, and the session key.
 * The key is built from the signed-in person's id, never from anything the caller sends, so one person cannot reach
 * another's page.
 */
export async function browserFor(event: H3Event, perMinute = 300): Promise<{ service: BrowserService, key: string, userId: string }> {
  const user = await requireUser(event)
  const { chatId } = await getValidatedRouterParams(event, z.object({ chatId: z.string().min(1).max(128) }).parse)
  enforceRateLimit(event, 'browser-view', user.id, perMinute, 60_000)
  const chat = await getChat(chatId)
  if (!chat || chat.userId !== user.id) throw createError({ statusCode: 404, statusMessage: 'Chat not found' })
  const service = defaultBrowserService()
  if (!service) throw createError({ statusCode: 503, statusMessage: 'Browser use is not set up on this server.' })
  return { service, key: browserKey(user.id, chatId), userId: user.id }
}

/** Runs a browser call and turns the browser's own errors into answers with the right status. */
export async function browserCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof BrowserError) throw createError({ statusCode: STATUS[err.code] ?? 400, statusMessage: err.message })
    throw err
  }
}
