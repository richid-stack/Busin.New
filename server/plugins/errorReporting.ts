import { definePlugin } from 'nitro'
import { reportServerError } from '../services/monitoring/report'

let installed = false

/** Sends unexpected server errors to the logs in the shape Cloud Error Reporting understands. */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    const event: any = context?.event
    reportServerError(error, {
      method: event?.req?.method ?? event?.method,
      path: event?.url?.pathname ?? event?.req?.url ?? event?.path,
      userAgent: event?.req?.headers?.get?.('user-agent') ?? undefined
    })
  })

  // A forgotten promise failing should be seen, not silently ignored or crash every open stream.
  if (!installed) {
    installed = true
    process.on('unhandledRejection', (reason) => {
      reportServerError(reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`))
    })
  }
})
