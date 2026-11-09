export interface UsageSnapshot {
  plan: 'guest' | 'free' | 'pro'
  limits: { id: string, label: string, daily: number, monthly: number }
  usedToday: number
  usedMonth: number
  dayResetsAt: string
  monthResetsAt: string
  unlimited: boolean
  planEndsAt: string | null
  tokens: { input: number, output: number }
}

export interface BillingOption { period: 'month' | 'year', months: number, label: string, price: number }
export interface PaymentSummary { reference: string, amount: number, currency: string, months: number, paidAt: string }
export interface BillingInfo { enabled: boolean, currency: string, options: BillingOption[], payments: PaymentSummary[] }
export interface NotificationSettings { emailRenewals: boolean, emailWorkflowFailures: boolean, emailTaskResults: boolean, emailNeedsYou: boolean, emailAvailable?: boolean, email?: string | null }
export type VerifyResult = { status: 'applied' | 'already', endsAt: string } | { status: 'pending' | 'failed' | 'refund_needed' }
