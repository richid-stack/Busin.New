import { wrapLanguageModel } from 'ai'
import type { LanguageModel } from 'ai'
import { isModelOutOfRoom } from './modelError'

type StreamResult = { stream: ReadableStream<any>, [k: string]: any }

export interface FallbackOptions {
  /** The model the person asked for. */
  modelId: string
  /** The next model to try when those in `skip` are out of room, or null when none is left. */
  next: (skip: string[]) => string | null
  /** Builds the model for an id. */
  make: (id: string) => LanguageModel
  /** Told when the work moves to another model. */
  onSwitch?: (from: string, to: string, error: unknown) => void
}

/**
 * Wraps a chat model so a call that fails because the model is out of allowance, busy or too small for the request
 * moves to the next model that is set up, with the same conversation and the tool results so far. This works at every step
 * of a reply, so a model that runs out after its first tool step does not end the chat there.
 *
 * Only a failure before any answer has started is handled: once words or tool calls have been sent, the reply is not
 * restarted on another model (that would repeat work the person already saw).
 */
export function withModelFallback(model: LanguageModel, opts: FallbackOptions): LanguageModel {
  const asModel = (m: LanguageModel) => wrapLanguageModel({ model: m as any, middleware: {} }) as any

  return wrapLanguageModel({
    model: model as any,
    middleware: {
      wrapStream: async ({ doStream, params }) => {
        const skipped: string[] = []
        let from = opts.modelId
        let run: () => PromiseLike<StreamResult> = doStream as any
        for (;;) {
          try {
            return await firstPartsOk(await run())
          } catch (err) {
            if (!isModelOutOfRoom(err)) throw err
            skipped.push(from)
            const to = opts.next(skipped)
            if (!to) throw err
            opts.onSwitch?.(from, to, err)
            from = to
            const fallback = asModel(opts.make(to))
            run = () => fallback.doStream(params)
          }
        }
      }
    }
  }) as any
}

/**
 * Reads the stream up to its first real part. If that part is an error, it is thrown so the caller can switch models.
 * Otherwise every part read so far is handed back first, followed by the rest of the stream.
 */
async function firstPartsOk(result: StreamResult): Promise<StreamResult> {
  const reader = result.stream.getReader()
  const held: any[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value?.type === 'error') {
      void reader.cancel().catch(() => {})
      throw value.error
    }
    held.push(value)
    // Preamble parts carry no answer; the first other part shows the model really started.
    if (value?.type !== 'stream-start' && value?.type !== 'response-metadata') break
  }
  const stream = new ReadableStream<any>({
    pull: async (controller) => {
      if (held.length) {
        controller.enqueue(held.shift())
        return
      }
      const { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: reason => reader.cancel(reason)
  })
  return { ...result, stream }
}
