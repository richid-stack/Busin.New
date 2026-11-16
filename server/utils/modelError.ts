// Turns a provider error into one short, honest line for the person. The details stay in the server log.
// The old version called everything a "rate limit", which sent people to wait when waiting would not help.

const BUSY = /\b503\b|UNAVAILABLE|high demand|overloaded|temporarily/i
const TOO_BIG = /\b413\b|request too large|reduce your message size|context length|too many tokens|maximum context/i
const DAILY = /per ?day|daily|PerDay|requests per day|limit: \d+, model/i
const LIMIT = /quota|RESOURCE_EXHAUSTED|\b429\b|rate[ -]?limit|\bI?O?TPM\b/i

/** True when another model could do the job: this one is out of allowance, rate limited, busy, or cannot take the size. */
export function isModelOutOfRoom(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { statusCode?: number }).statusCode ?? '')}` : String(error)
  return TOO_BIG.test(message) || BUSY.test(message) || LIMIT.test(message)
}

export function modelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (TOO_BIG.test(message)) {
    return 'This model cannot take a message this big on its current plan. Try a shorter message, or pick another model from the dropdown.'
  }
  if (BUSY.test(message) && !LIMIT.test(message)) {
    return 'This model is busy right now. Try again in a moment, or pick another model from the dropdown.'
  }
  if (LIMIT.test(message)) {
    if (DAILY.test(message)) return 'This model has used up its free allowance for today. Pick another model from the dropdown, or try again tomorrow.'
    return 'This model has reached its rate limit. Wait a moment and try again, or pick another model from the dropdown.'
  }
  return 'Something went wrong while generating the response. Please try again.'
}
