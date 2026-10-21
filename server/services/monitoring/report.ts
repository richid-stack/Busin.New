/**
 * Error reporting that costs nothing and needs no account. On Cloud Run, a JSON line on stderr with
 * `severity: ERROR` and a stack trace is picked up by Cloud Logging and grouped by Cloud Error
 * Reporting, which can email an alert. Nothing leaves Google Cloud.
 *
 * Only the message, the stack, the method and the path are logged. Never the request body, headers,
 * query string or the signed-in person, because those can hold passwords, tokens and private chats.
 */

import { HTTPError } from 'nitro'

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}/g,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:api[_-]?key|token|secret|password|passwd|authorization|x-cron-secret|x-webhook-secret)(["']?\s*[:=]\s*["']?)[^\s"',;&]{3,}/gi
]

/** Removes anything that looks like a credential from text that is about to be logged. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, sep) => (typeof sep === 'string' && /[:=]/.test(sep) ? `${match.slice(0, match.indexOf(sep))}${sep}[removed]` : '[removed]'))
  }
  return out
}

/** The path only. Query strings carry secrets (webhook `?secret=`) and are dropped. */
export function safePath(raw: string | undefined | null): string {
  if (!raw) return ''
  try {
    return new URL(raw, 'http://local').pathname.slice(0, 300)
  } catch {
    return String(raw).split('?')[0]!.slice(0, 300)
  }
}

const MAX_TEXT = 8000

export interface ErrorRequest { method?: string, path?: string, status?: number }

export interface ErrorEntry {
  severity: 'ERROR' | 'WARNING'
  message: string
  serviceContext?: { service: string, version: string }
  context?: { httpRequest: { method: string, url: string, responseStatusCode?: number } }
  source: 'server' | 'browser'
  '@type'?: string
}

const service = () => ({ service: process.env.K_SERVICE || 'openlobs', version: process.env.K_REVISION || process.env.npm_package_version || 'dev' })

/**
 * True for errors that are part of normal use (wrong password, not found, rate limited). Only the app's own
 * HTTP errors count: a 401, 403 or 429 from an AI or payment provider means a bad key or an exhausted quota,
 * which someone needs to hear about.
 */
export function isExpectedError(error: unknown): boolean {
  if (!(error instanceof HTTPError)) return false
  const status = Number(error.status ?? 0)
  return status >= 400 && status < 500
}

export function formatServerError(error: unknown, req: ErrorRequest = {}): ErrorEntry {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')
  // Cloud Error Reporting reads the stack out of `message`, so the stack goes there.
  const text = scrubSecrets(err.stack || `${err.name}: ${err.message}`).slice(0, MAX_TEXT)
  return {
    severity: 'ERROR',
    '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    message: text,
    serviceContext: service(),
    context: req.path || req.method
      ? { httpRequest: { method: req.method || 'GET', url: safePath(req.path), responseStatusCode: req.status } }
      : undefined,
    source: 'server'
  }
}

export interface BrowserErrorInput { message: string, stack?: string, page?: string, kind?: string }

/** A problem reported by someone's browser. Logged as a warning: it is outside input and must not page anyone. */
export function formatBrowserError(input: BrowserErrorInput): ErrorEntry {
  const body = [input.kind ? `[${String(input.kind).slice(0, 30)}]` : '', String(input.message ?? '').slice(0, 500), String(input.stack ?? '').slice(0, 3000)].filter(Boolean).join('\n')
  return {
    severity: 'WARNING',
    message: `Browser error: ${scrubSecrets(body)}`.slice(0, MAX_TEXT),
    serviceContext: service(),
    context: { httpRequest: { method: 'GET', url: safePath(input.page) } },
    source: 'browser'
  }
}

export function writeEntry(entry: ErrorEntry, sink: (line: string) => void = line => console.error(line)) {
  sink(JSON.stringify(entry))
}

export function reportServerError(error: unknown, req: ErrorRequest = {}, sink?: (line: string) => void) {
  if (isExpectedError(error)) return false
  writeEntry(formatServerError(error, req), sink)
  return true
}
