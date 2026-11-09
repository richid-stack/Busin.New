/**
 * The check every shared thing passes before it can be published. It looks only at text, because that is
 * all a shared agent or skill is. It exists because community libraries are a known target: someone
 * uploads something that looks helpful and quietly steals keys, hides what it does, or points at a
 * look-alike site. A "blocked" result stops publishing; a "review" result is shown to everyone who
 * looks at it, and goes to the review queue once things can be listed publicly.
 *
 * It is a net, not a guarantee: it catches the common, careless and obvious cases. Reading what you
 * install, and the permission list, are still the real protection.
 */

export type Severity = 'block' | 'review'
export type FindingKind = 'secret' | 'card' | 'hidden-text' | 'concealment' | 'override' | 'send-out' | 'link'

export interface Finding {
  field: string
  kind: FindingKind
  severity: Severity
  message: string
  /** A short piece of the text around the match, with anything secret masked. */
  excerpt: string
}

export interface ScanResult {
  verdict: 'ok' | 'review' | 'blocked'
  findings: Finding[]
}

const SECRETS: Array<{ name: string, re: RegExp }> = [
  { name: 'an OpenAI-style key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'a payment key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'a Groq key', re: /\bgsk_[A-Za-z0-9]{20,}/ },
  { name: 'a Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'an AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'a GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'a sign-in token (JWT)', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'a password or key written into the text', re: /\b(?:api[_ -]?key|secret|token|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}/i }
]

// Characters people cannot see: they can hide instructions, or make text read differently from what it says.
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|\uDB40[\uDC00-\uDC7F]/

const CONCEAL: RegExp[] = [
  /\bdo not (?:tell|inform|mention|reveal|show|notify)\b[^.\n]{0,40}\b(?:the )?(?:user|person|owner)\b/i,
  /\bdon'?t (?:tell|inform|mention|reveal|show|notify)\b[^.\n]{0,40}\b(?:the )?(?:user|person|owner)\b/i,
  /\bhide (?:this|that|it|these|what)\b[^.\n]{0,40}\bfrom (?:the |your )?(?:user|person|owner)\b/i,
  /\bwithout (?:telling|informing|notifying|asking|alerting) (?:the |your )?(?:user|person|owner)\b/i,
  /\b(?:secretly|silently|covertly|quietly) (?:send|forward|copy|upload|post|email|share)\b/i,
  /\bkeep (?:this|that|it) (?:a )?(?:secret|hidden)\b/i
]

const OVERRIDE: RegExp[] = [
  /\bignore (?:all |any |the )?(?:previous|prior|above|earlier|system|safety)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|messages?)/i,
  /\bdisregard (?:all |any |the )?(?:previous|prior|above|earlier|system|safety)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?)/i,
  /\b(?:skip|bypass|disable|turn off|do not wait for|never ask for) (?:the )?(?:approval|permission|confirmation)\b/i,
  /\boverride (?:the )?(?:safety|approval|system) /i
]

// Sending information somewhere outside the chat.
const SEND_OUT: RegExp[] = [
  /\b(?:send|post|upload|forward|submit|leak|exfiltrate)\b[^.\n]{0,60}\b(?:chat|conversation|messages?|memory|memories|keys?|tokens?|passwords?|files?|contacts?|emails?|credentials?)\b[^.\n]{0,60}\bhttps?:\/\//i,
  /\bexfiltrat/i
]

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'shorturl.at', 'tiny.cc', 'rebrand.ly']

// Names people trust, and the only domains that really belong to them. A link that uses the name on some
// other domain is the classic look-alike.
const BRANDS: Array<{ token: string, domains: string[] }> = [
  { token: 'paystack', domains: ['paystack.com', 'paystack.co'] },
  { token: 'google', domains: ['google.com', 'googleapis.com', 'google.com.gh', 'withgoogle.com', 'googleusercontent.com'] },
  { token: 'microsoft', domains: ['microsoft.com', 'microsoftonline.com', 'office.com', 'live.com'] },
  { token: 'github', domains: ['github.com', 'githubusercontent.com', 'github.io'] },
  { token: 'stripe', domains: ['stripe.com'] },
  { token: 'slack', domains: ['slack.com'] },
  { token: 'notion', domains: ['notion.so', 'notion.com'] },
  { token: 'openlobs', domains: ['openlobs.app', 'openlobs.dev', 'openlobs.org'] },
  { token: 'mtn', domains: ['mtn.com', 'mtn.com.gh', 'mtn.gh'] },
  { token: 'vodafone', domains: ['vodafone.com', 'vodafone.com.gh'] },
  { token: 'apple', domains: ['apple.com', 'icloud.com'] },
  { token: 'facebook', domains: ['facebook.com', 'fb.com', 'meta.com'] },
  { token: 'whatsapp', domains: ['whatsapp.com', 'whatsapp.net'] },
  { token: 'anthropic', domains: ['anthropic.com', 'claude.ai', 'claude.com'] },
  { token: 'openai', domains: ['openai.com', 'chatgpt.com'] },
  { token: 'gra', domains: ['gra.gov.gh'] }
]

const luhn = (digits: string) => {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

const around = (text: string, index: number, length: number) => {
  const from = Math.max(0, index - 25)
  const to = Math.min(text.length, index + length + 25)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`
}

/** Shows only the start of something secret, so a report never repeats it. */
const mask = (s: string) => `${s.slice(0, 4)}…(${s.length} characters)`

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, '') } catch { return null }
}

const belongsTo = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

function scanLinks(field: string, text: string, out: Finding[]) {
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '')
    const host = hostOf(url)
    if (!host) continue
    const add = (message: string) => out.push({ field, kind: 'link', severity: 'review', message, excerpt: around(text, m.index ?? 0, url.length) })
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) { add('A link goes to a bare network address, not a named website.'); continue }
    if (host.split('.').some(l => l.startsWith('xn--')) || /[^\x00-\x7F]/.test(host)) { add('A link uses a web address with look-alike letters.'); continue }
    if (SHORTENERS.some(s => belongsTo(host, s))) { add('A link is shortened, so you cannot see where it goes.'); continue }
    const letters = host.replace(/[^a-z]/g, '')
    const brand = BRANDS.find(b => host.split(/[.-]/).some(l => l === b.token) || (b.token.length > 4 && letters.includes(b.token)))
    if (brand && !brand.domains.some(d => belongsTo(host, d))) add(`A link uses the name "${brand.token}" but is not on ${brand.domains[0]}.`)
  }
}

/** Looks over the text fields of something about to be shared. */
export function scanText(fields: Record<string, string>): ScanResult {
  const findings: Finding[] = []
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue

    for (const { name, re } of SECRETS) {
      const m = re.exec(text)
      if (m) findings.push({ field, kind: 'secret', severity: 'block', message: `This looks like ${name}. Remove it: anything shared can be read by everyone with the link.`, excerpt: `${text.slice(Math.max(0, m.index - 12), m.index).replace(/\s+/g, ' ')}${mask(m[0])}` })
    }

    for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
        findings.push({ field, kind: 'card', severity: 'block', message: 'This looks like a payment card number. Remove it.', excerpt: `${digits.slice(0, 4)}…(${digits.length} digits)` })
      }
    }

    const hidden = HIDDEN.exec(text)
    if (hidden) findings.push({ field, kind: 'hidden-text', severity: 'block', message: 'The text has invisible characters. They can hide instructions that you cannot see.', excerpt: around(text, hidden.index, 1).replace(HIDDEN, '▯') })

    for (const re of CONCEAL) {
      const m = re.exec(text)
      if (m) findings.push({ field, kind: 'concealment', severity: 'block', message: 'It tells the assistant to hide what it does from the person using it.', excerpt: around(text, m.index, m[0].length) })
    }
    for (const re of OVERRIDE) {
      const m = re.exec(text)
      if (m) findings.push({ field, kind: 'override', severity: 'block', message: 'It tells the assistant to ignore its rules or skip asking for approval.', excerpt: around(text, m.index, m[0].length) })
    }
    for (const re of SEND_OUT) {
      const m = re.exec(text)
      if (m) findings.push({ field, kind: 'send-out', severity: 'review', message: 'It may tell the assistant to send private information to a web address.', excerpt: around(text, m.index, m[0].length) })
    }

    scanLinks(field, text, findings)
  }
  const verdict = findings.some(f => f.severity === 'block') ? 'blocked' : findings.length ? 'review' : 'ok'
  return { verdict, findings }
}
