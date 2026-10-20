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
