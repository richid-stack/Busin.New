/**
 * Email through Resend. Without RESEND_API_KEY and EMAIL_FROM nothing is sent and nothing breaks:
 * every caller treats email as a courtesy on top of what the app already does.
 */
export interface EmailConfig { apiKey: string, from: string }

export const emailConfig = (env: NodeJS.ProcessEnv = process.env): EmailConfig | null => {
  const apiKey = (env.RESEND_API_KEY || '').trim()
  const from = (env.EMAIL_FROM || '').trim()
  return apiKey && from ? { apiKey, from } : null
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** The same key sent twice makes Resend deliver one email, so a retry cannot double-send. */
  idempotencyKey?: string
}

export interface EmailDeps { fetch?: typeof fetch, config?: EmailConfig | null }

const looksLikeEmail = (v: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) && v.length <= 254

export async function sendEmail(msg: EmailMessage, deps: EmailDeps = {}): Promise<{ sent: boolean, reason?: string }> {
  const config = deps.config === undefined ? emailConfig() : deps.config
  if (!config) return { sent: false, reason: 'Email is not set up.' }
  if (!looksLikeEmail(msg.to)) return { sent: false, reason: 'No valid email address.' }

  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(msg.idempotencyKey ? { 'Idempotency-Key': msg.idempotencyKey.slice(0, 256) } : {})
      },
      body: JSON.stringify({ from: config.from, to: [msg.to], subject: msg.subject.slice(0, 200), html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) {
      console.warn(`[email] Resend refused the message (${res.status}).`)
      return { sent: false, reason: `The email service refused it (${res.status}).` }
    }
    return { sent: true }
  } catch (err) {
    console.warn('[email] Could not send:', (err as Error)?.message)
    return { sent: false, reason: 'Could not reach the email service.' }
  }
}

// ---- Templates ----

export const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

const layout = (title: string, bodyHtml: string, footer: string) => `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e4e4e7" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 18px;font-size:15px;font-weight:700">OpenLobs</p>
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr><tr><td style="padding:8px 28px 24px"><p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#71717a">${footer}</p></td></tr></table>
</td></tr></table></body></html>`

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${html}</p>`
const button = (url: string, label: string) => `<p style="margin:18px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:9px;font-size:14px;font-weight:600">${escapeHtml(label)}</a></p>`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const money = (amountMinor: number, currency: string) => `${currency} ${(amountMinor / 100).toFixed(2)}`

export function receiptEmail(i: { name?: string, months: number, amountMinor: number, currency: string, reference: string, endsAt: string, appUrl?: string }): Omit<EmailMessage, 'to'> {
  const html = layout('Payment received', [
    p(`Hi ${escapeHtml(i.name || 'there')}, thank you. Your Pro plan is active.`),
    p(`<strong>${escapeHtml(money(i.amountMinor, i.currency))}</strong> for ${i.months} month${i.months === 1 ? '' : 's'}.<br>Pro runs until <strong>${escapeHtml(day(i.endsAt))}</strong>.`),
    p(`Reference: <span style="font-family:monospace">${escapeHtml(i.reference)}</span>`),
    i.appUrl ? button(`${i.appUrl}/settings`, 'See your plan') : ''
  ].join(''), 'This is your receipt. Keep it for your records.')
  const text = `Payment received\n\nHi ${i.name || 'there'}, thank you. Your Pro plan is active.\n${money(i.amountMinor, i.currency)} for ${i.months} month${i.months === 1 ? '' : 's'}. Pro runs until ${day(i.endsAt)}.\nReference: ${i.reference}\n${i.appUrl ? `\n${i.appUrl}/settings\n` : ''}`
  return { subject: 'Your OpenLobs Pro receipt', html, text }
}

export function renewalReminderEmail(i: { name?: string, endsAt: string, appUrl?: string }): Omit<EmailMessage, 'to'> {
  const html = layout('Your Pro plan ends soon', [
    p(`Hi ${escapeHtml(i.name || 'there')}, your Pro plan ends on <strong>${escapeHtml(day(i.endsAt))}</strong>.`),
    p('After that you go back to the Free plan, with lower daily and monthly limits. Your chats, agents and workflows stay as they are.'),
    i.appUrl ? button(`${i.appUrl}/settings`, 'Extend Pro') : ''
  ].join(''), 'You can switch these emails off in Settings → Notifications.')
  const text = `Your Pro plan ends soon\n\nHi ${i.name || 'there'}, your Pro plan ends on ${day(i.endsAt)}. After that you go back to the Free plan, with lower limits. Your chats, agents and workflows stay as they are.\n${i.appUrl ? `\nExtend Pro: ${i.appUrl}/settings\n` : ''}\nSwitch these emails off in Settings → Notifications.`
  return { subject: 'Your OpenLobs Pro plan ends soon', html, text }
}

export function workflowFailedEmail(i: { name?: string, workflowName: string, step?: string, error?: string, appUrl?: string, workflowId?: string }): Omit<EmailMessage, 'to'> {
  const detail = i.error ? p(`<span style="color:#71717a">${escapeHtml(i.step ? `${i.step}: ` : '')}${escapeHtml(i.error.slice(0, 300))}</span>`) : ''
  const html = layout('A scheduled workflow failed', [
    p(`Hi ${escapeHtml(i.name || 'there')}, the scheduled run of <strong>${escapeHtml(i.workflowName)}</strong> did not finish.`),
    detail,
    i.appUrl && i.workflowId ? button(`${i.appUrl}/workflows/${encodeURIComponent(i.workflowId)}`, 'Open the workflow') : ''
  ].join(''), 'We send at most one of these per workflow per day. You can switch them off in Settings → Notifications.')
  const text = `A scheduled workflow failed\n\nHi ${i.name || 'there'}, the scheduled run of "${i.workflowName}" did not finish.\n${i.error ? `${i.step ? `${i.step}: ` : ''}${i.error.slice(0, 300)}\n` : ''}${i.appUrl && i.workflowId ? `\n${i.appUrl}/workflows/${encodeURIComponent(i.workflowId)}\n` : ''}\nSwitch these off in Settings → Notifications.`
  return { subject: `Workflow failed: ${i.workflowName}`.slice(0, 150), html, text }
}
