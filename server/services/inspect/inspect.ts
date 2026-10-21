import type { LanguageModel } from 'ai'
import { judgeScreenshot, describeProgress } from './judge'
import type { Inspection, PreviousDefect } from './judge'
import { InspectError } from './browser'
import type { ScreenshotProvider } from './screenshot'
import { availableModels, getLanguageModel, providerOf } from '../../utils/models'
import { modelCost } from '../usage/plans'
import { UsageLimitError, chargeUsage } from '../usage/usage'
import { MAX_FILE_BYTES, safeFileName } from '../files/store'

/**
 * One look at one screen: get the picture (from a web address or an uploaded image), charge the credits, have
 * a vision model judge it, and keep a copy of the picture for the person to see. A second call with the earlier
 * defects makes it a re-check, which is how "fix, look again, compare" works.
 */

export interface InspectInput {
  userId: string
  requirements: string
  url?: string
  image?: { bytes: Uint8Array, mediaType: string, name?: string }
  previous?: PreviousDefect[]
  fullPage?: boolean
  width?: number
  height?: number
  colorScheme?: 'light' | 'dark'
}

export interface InspectDeps {
  provider: ScreenshotProvider | null
  save?: (input: { userId: string, name: string, mime: string, bytes: Uint8Array }) => Promise<{ id: string }>
  /** Overridable for tests. */
  judge?: typeof judgeScreenshot
  charge?: typeof chargeUsage
  model?: { id: string, model: LanguageModel } | null
  signal?: AbortSignal
}

export interface InspectOutcome extends Inspection {
  progressNote: string
  source: string
  screenshotFileId: string | null
  model: string
}

/** The picture is read by the model, so it must be one that takes images. The fast text-only provider is skipped. */
export function pickVisionModel(): { id: string, model: LanguageModel } | null {
  const id = availableModels().find(m => providerOf(m) !== 'groq')
  return id ? { id, model: getLanguageModel(id) } : null
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export async function runInspection(input: InspectInput, deps: InspectDeps): Promise<InspectOutcome> {
  if (input.requirements.trim().length < 10) throw new InspectError('Say what the screen should look like or do, so there is something to check it against.')
  if (!input.url && !input.image) throw new InspectError('Give a web address to screenshot, or attach a picture.')

  const chosen = deps.model === undefined ? pickVisionModel() : deps.model
  if (!chosen) throw new InspectError('No AI model that can look at pictures is configured on this server.')

  // 1. The picture.
  let bytes: Uint8Array
  let mediaType: string
  let source: string
  if (input.image) {
    if (!IMAGE_TYPES.has(input.image.mediaType.toLowerCase())) throw new InspectError('Only PNG, JPEG, WebP or GIF pictures can be checked.')
    bytes = input.image.bytes
    mediaType = input.image.mediaType
    source = input.image.name || 'attached picture'
  } else {
    if (!deps.provider) throw new InspectError('Taking screenshots of web pages is not set up on this server yet. Attach a screenshot instead.')
    const shot = await deps.provider.capture({ url: input.url!, fullPage: input.fullPage, width: input.width, height: input.height, colorScheme: input.colorScheme }, deps.signal)
    bytes = shot.bytes
    mediaType = shot.mediaType
    source = shot.url
  }

  // 2. Credits, taken after the picture exists so a page that fails to load costs nothing, and given back if the look fails.
  let charge: { refund: () => Promise<void> }
  try {
    charge = await (deps.charge ?? chargeUsage)(input.userId, modelCost(chosen.id))
  } catch (err) {
    if (err instanceof UsageLimitError) throw new InspectError(err.message)
    throw err
  }

  // 3. The look.
  let inspection: Inspection
  try {
    inspection = await (deps.judge ?? judgeScreenshot)({ image: { bytes, mediaType }, requirements: input.requirements, previous: input.previous, context: source }, { model: chosen.model, abortSignal: deps.signal })
  } catch (err: any) {
    await charge.refund()
    if (err instanceof InspectError) throw err
    throw new InspectError('The review could not be completed. Try again in a moment.')
  }

  // 4. A copy to show. A picture too big for storage is still judged, just not kept.
  let screenshotFileId: string | null = null
  if (deps.save && bytes.length <= MAX_FILE_BYTES) {
    const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : mediaType.includes('gif') ? 'gif' : 'jpg'
    screenshotFileId = await deps.save({ userId: input.userId, name: safeFileName(`inspection ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`, ext), mime: mediaType, bytes }).then(r => r.id).catch(() => null)
  }
  return { ...inspection, progressNote: describeProgress(inspection), source, screenshotFileId, model: chosen.id }
}
