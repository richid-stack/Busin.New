import { getFirebaseAuth, getFirebaseDb } from '../../utils/firebaseAdmin'
import { needsYouEmail, renewalReminderEmail, sendEmail, taskFinishedEmail, workflowFailedEmail } from '../email/email'
import type { EmailMessage } from '../email/email'

const SETTINGS = 'user_settings'
const LOG = 'notification_log'

export interface NotificationSettings { emailRenewals: boolean, emailWorkflowFailures: boolean, emailTaskResults: boolean, emailNeedsYou: boolean }
export const DEFAULT_NOTIFICATIONS: NotificationSettings = { emailRenewals: true, emailWorkflowFailures: true, emailTaskResults: true, emailNeedsYou: true }

export interface NotifyDeps {
  db: any
  now: () => Date
  send: (msg: EmailMessage) => Promise<{ sent: boolean }>
  /** Email and name of a person, if they have any. */
  contact: (userId: string) => Promise<{ email?: string, name?: string } | null>
  appUrl?: string
}

export const defaultNotifyDeps = (): NotifyDeps => ({
  db: getFirebaseDb(),
  now: () => new Date(),
  send: msg => sendEmail(msg),
  contact: async (userId) => {
    const u = await getFirebaseAuth().getUser(userId).catch(() => null)
    return u ? { email: u.email || undefined, name: u.displayName || undefined } : null
  },
  appUrl: process.env.APP_URL
})

export async function getNotificationSettings(db: any, userId: string): Promise<NotificationSettings> {
  const doc = await db.collection(SETTINGS).doc(userId).get()
  const d = doc.exists ? doc.data() : {}
  return { emailRenewals: d.emailRenewals !== false, emailWorkflowFailures: d.emailWorkflowFailures !== false, emailTaskResults: d.emailTaskResults !== false, emailNeedsYou: d.emailNeedsYou !== false }
}

export async function setNotificationSettings(db: any, userId: string, patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
  const ref = db.collection(SETTINGS).doc(userId)
  // Two quick changes to different switches must both survive, so the read and the write are one transaction.
  return await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    const d = doc.exists ? doc.data() : {}
    const current = { emailRenewals: d.emailRenewals !== false, emailWorkflowFailures: d.emailWorkflowFailures !== false, emailTaskResults: d.emailTaskResults !== false, emailNeedsYou: d.emailNeedsYou !== false }
    const next = { ...current, ...patch }
    tx.set(ref, { ...d, userId, ...next, updatedAt: new Date().toISOString() })
    return next
  })
}

export const REMINDER_DAYS = 3

export interface ReminderSummary { checked: number, sent: number, skipped: number }

/**
 * Emails people whose Pro plan ends within REMINDER_DAYS, once per plan end date. Run once a day.
 * Reads only the plans that end soon: a range on one field, which needs no extra index.
 */
export async function processRenewalReminders(deps: NotifyDeps, limit = 200): Promise<ReminderSummary> {
  const now = deps.now()
  const horizon = new Date(now.getTime() + REMINDER_DAYS * 86_400_000).toISOString()
  const snap = await deps.db.collection('user_plans').where('endsAt', '<=', horizon).where('endsAt', '>', now.toISOString()).get()
  const summary: ReminderSummary = { checked: 0, sent: 0, skipped: 0 }

  for (const doc of (snap.docs as any[]).slice(0, limit)) {
    const plan = doc.data()
    summary.checked++
    const endsAt = typeof plan.endsAt === 'string' ? plan.endsAt : ''
    if (plan.plan !== 'pro' || !endsAt || new Date(endsAt) <= now || plan.reminderFor === endsAt) { summary.skipped++; continue }
    const settings = await getNotificationSettings(deps.db, doc.id)
    const email = plan.email || (await deps.contact(doc.id))?.email
    if (!settings.emailRenewals || !email) { summary.skipped++; continue }

    const name = (await deps.contact(doc.id))?.name
    const result = await deps.send({ ...renewalReminderEmail({ name, endsAt, appUrl: deps.appUrl }), to: email, idempotencyKey: `renewal-${doc.id}-${endsAt}` }).catch(() => ({ sent: false }))
    if (result.sent) {
      await doc.ref.update({ reminderFor: endsAt })
      summary.sent++
    } else {
      summary.skipped++
    }
  }
  return summary
}

/** What the failure email says, taken from a workflow and its failed run. Workflows have a `title`; log entries carry a `message`. */
export function failureInfoFromRun(workflow: { id: string, userId: string, title?: string }, run: { logs?: any[] }): FailureInfo {
  const failed = (run.logs || []).find((l: any) => l?.status === 'failed')
  return {
    userId: workflow.userId,
    workflowId: workflow.id,
    workflowName: String(workflow.title || 'Workflow'),
    step: typeof failed?.nodeTitle === 'string' ? failed.nodeTitle : undefined,
    error: typeof failed?.message === 'string' ? failed.message : undefined
  }
}

export interface FailureInfo { userId: string, workflowId: string, workflowName: string, step?: string, error?: string }

/** At most one failure email per workflow per day, and only if the person has not switched them off. */
export async function notifyWorkflowFailure(deps: NotifyDeps, info: FailureInfo): Promise<boolean> {
  const settings = await getNotificationSettings(deps.db, info.userId)
  if (!settings.emailWorkflowFailures) return false

  const key = `workflow-failed__${info.workflowId}__${deps.now().toISOString().slice(0, 10)}`
  const logRef = deps.db.collection(LOG).doc(key)
  if ((await logRef.get()).exists) return false

  const who = await deps.contact(info.userId)
  if (!who?.email) return false
  const result = await deps.send({
    ...workflowFailedEmail({ name: who.name, workflowName: info.workflowName, step: info.step, error: info.error, appUrl: deps.appUrl, workflowId: info.workflowId }),
    to: who.email,
    idempotencyKey: key
  }).catch(() => ({ sent: false }))
  if (!result.sent) return false
  await logRef.set({ userId: info.userId, kind: 'workflow-failed', createdAt: deps.now().toISOString() })
  return true
}

export interface FinishedTask { id: string, userId: string, goal: string, status: string, outcome: string, startedAt: string | null, finishedAt: string | null }

/** A task that took this long is one the person has probably walked away from. Shorter ones they watched. */
export const TASK_EMAIL_MIN_MS = 2 * 60_000

/** One email when a task that ran for a while ends, unless the person switched these off. Cancelled tasks never send one. */
export async function notifyTaskFinished(deps: NotifyDeps, task: FinishedTask): Promise<boolean> {
  if (task.status === 'cancelled') return false
  const took = task.startedAt && task.finishedAt ? new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime() : 0
  if (took < TASK_EMAIL_MIN_MS) return false
  const settings = await getNotificationSettings(deps.db, task.userId)
  if (!settings.emailTaskResults) return false

  const key = `task-finished__${task.id}`
  const logRef = deps.db.collection(LOG).doc(key)
  if ((await logRef.get()).exists) return false
  const who = await deps.contact(task.userId)
  if (!who?.email) return false
  const result = await deps.send({
    ...taskFinishedEmail({ name: who.name, goal: task.goal, outcome: task.outcome, status: task.status, appUrl: deps.appUrl, taskId: task.id }),
    to: who.email,
    idempotencyKey: key
  }).catch(() => ({ sent: false }))
  if (!result.sent) return false
  await logRef.set({ userId: task.userId, kind: 'task-finished', createdAt: deps.now().toISOString() })
  return true
}

/** One email per wait when the assistant's browser is waiting for the person and they have not looked at it, unless they switched these off. */
export async function notifyNeedsYou(deps: NotifyDeps, hold: { key: string, userId: string, kind: 'chat' | 'task', ref: string, label: string, createdAt: string, expiresAt: string }): Promise<boolean> {
  const settings = await getNotificationSettings(deps.db, hold.userId)
  if (!settings.emailNeedsYou) return false
  // At most one email per page per ten minutes, even if the assistant keeps coming back to the same sign-in page.
  const bucket = Math.floor(deps.now().getTime() / 600_000)
  const key = `needs-you__${hold.key.replace(/[^A-Za-z0-9_-]/g, '_')}__${bucket}`.slice(0, 200)
  const logRef = deps.db.collection(LOG).doc(key)
  if ((await logRef.get()).exists) return false
  const who = await deps.contact(hold.userId)
  if (!who?.email) return false
  const minutesLeft = Math.max(1, Math.round((new Date(hold.expiresAt).getTime() - deps.now().getTime()) / 60_000))
  const result = await deps.send({
    ...needsYouEmail({ name: who.name, what: hold.label, kind: hold.kind, minutesLeft, appUrl: deps.appUrl, ref: hold.ref }),
    to: who.email,
    idempotencyKey: key
  }).catch(() => ({ sent: false }))
  if (!result.sent) return false
  await logRef.set({ userId: hold.userId, kind: 'needs-you', createdAt: deps.now().toISOString() })
  return true
}
