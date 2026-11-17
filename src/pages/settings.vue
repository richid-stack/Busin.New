<script setup lang="ts">
import StateCard from '../components/state/StateCard.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useColorMode } from '@vueuse/core'
import { useAppearance } from '../composables/useAppearance'
import { ACCENTS } from '../utils/appearance'
import type { Appearance } from '../utils/appearance'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'
import { useAccount } from '../composables/useAccount'
import { useBilling } from '../composables/useBilling'
import { usePushAlerts } from '../composables/usePushAlerts'

import LobbyVoiceSettings from '../components/settings/LobbyVoiceSettings.vue'
import SettingsNav from '../components/settings/SettingsNav.vue'
import SettingRow from '../components/settings/SettingRow.vue'
import DefaultsSection from '../components/settings/DefaultsSection.vue'
import ApprovalsSection from '../components/settings/ApprovalsSection.vue'
import PowersSection from '../components/settings/PowersSection.vue'
import DataSection from '../components/settings/DataSection.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const colorMode = useColorMode()
const { openAuthModal, firebaseUser, signInMethod, sendPasswordReset, updateDisplayName, signOutUser } = useFirebaseAuth()
const { user, loggedIn, clearSession } = useUserSession()
const { usage, usageError, loadingUsage, fetchUsage } = useAccount()
const { billing, billingFailed, notifications, fetchBilling, startCheckout, fetchNotifications, saveNotifications } = useBilling()
const { availability: alertsAvailability, on: alertsOn, busy: alertsBusy, error: alertsError, testSent, enable: enableAlerts, disable: disableAlerts, sendTest } = usePushAlerts()

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

// The signed-in state is the server session, which is what every API call here is checked against.
const loadAll = () => { fetchUsage(); fetchBilling(); fetchNotifications() }
onMounted(() => { if (loggedIn.value) loadAll() })
watch(loggedIn, (v) => { if (v) loadAll() })

// ---- Profile ----
const name = ref('')
watch(() => user.value?.name, (n) => { if (n && !name.value) name.value = n }, { immediate: true })
const savingName = ref(false)
const nameChanged = computed(() => name.value.trim() !== '' && name.value.trim() !== user.value?.name)

async function saveName() {
  if (!nameChanged.value || savingName.value) return
  savingName.value = true
  try {
    await updateDisplayName(name.value)
    toast.add({ title: 'Name updated', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not update your name', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    savingName.value = false
  }
}

const methodLabel = computed(() => ({ google: 'Google', github: 'GitHub', password: 'Email and password', other: 'Your account' })[signInMethod.value])
const methodIcon = computed(() => ({ google: 'i-simple-icons-google', github: 'i-simple-icons-github', password: 'i-lucide-mail', other: 'i-lucide-user' })[signInMethod.value])

// ---- Usage ----
const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0)
const barColor = (p: number) => (p >= 90 ? 'error' : p >= 70 ? 'warning' : 'primary')
const resetsLabel = (iso: string, kind: 'day' | 'month') => {
  const d = new Date(iso)
  return kind === 'day' ? 'Resets at midnight (Ghana time)' : `Resets on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}
const fmt = (n: number) => n.toLocaleString('en-GB')

// ---- Buying Pro ----
const buying = ref<string | null>(null)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const money = (amount: number, currency: string, minor = false) => `${currency} ${(minor ? amount / 100 : amount).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

async function buy(period: 'month' | 'year') {
  if (buying.value) return
  buying.value = period
  try {
    await startCheckout(period)
  } catch (err: any) {
    buying.value = null
    toast.add({ title: 'Could not start the payment', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

// ---- Notifications ----
async function setNotification(key: 'emailRenewals' | 'emailWorkflowFailures' | 'emailTaskResults' | 'emailNeedsYou', value: boolean) {
  try {
    await saveNotifications({ [key]: value })
  } catch (err: any) {
    toast.add({ title: 'Could not change that', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

// ---- Alerts on this device ----
const alertsCannot = computed(() => alertsAvailability.value === 'unsupported' || alertsAvailability.value === 'needs-install')
const alertsHint = computed(() => ({
  'needs-install': 'On iPhone and iPad, add OpenLobs to your Home Screen first (Share, then Add to Home Screen), open it from there, then turn this on.',
  unsupported: 'This browser cannot show alerts.',
  blocked: 'Alerts are blocked in this browser. Allow them in the site settings, then turn this on.',
  ready: ''
})[alertsAvailability.value])
const setAlerts = (value: boolean) => (value ? enableAlerts() : disableAlerts())

// ---- Security ----
const resetting = ref(false)
async function resetPassword() {
  const email = firebaseUser.value?.email
  if (!email || resetting.value) return
  resetting.value = true
  try {
    await sendPasswordReset(email)
    toast.add({ title: 'Check your email', description: `We sent a password reset link to ${email}.`, icon: 'i-lucide-mail-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not send the email', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    resetting.value = false
  }
}

async function logOut() {
  await signOutUser()
  await clearSession()
  router.push('/')
}

const { appearance, reset: resetAppearance } = useAppearance()
const appearanceRows: Array<{ key: keyof Appearance, title: string, hint: string, options: Array<{ value: string, label: string }> }> = [
  { key: 'text', title: 'Text size', hint: 'For chats and pages.', options: [{ value: 'small', label: 'Small' }, { value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }] },
  { key: 'width', title: 'Chat width', hint: 'Wider fits tables and code better.', options: [{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }] },
  { key: 'motion', title: 'Motion', hint: 'Full unfolds and slides. Reduced makes everything instant. System follows your device.', options: [{ value: 'system', label: 'System' }, { value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }] }
]
const modes = [
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
  { value: 'auto', label: 'System', icon: 'i-lucide-monitor' }
] as const


// ---- Sections ----
const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'i-lucide-user-round' },
  { id: 'plan', label: 'Plan and usage', icon: 'i-lucide-gauge' },
  { id: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
  { id: 'defaults', label: 'Defaults', icon: 'i-lucide-sliders-horizontal' },
  { id: 'voice', label: 'Voice', icon: 'i-lucide-mic' },
  { id: 'notifications', label: 'Notifications', icon: 'i-lucide-bell' },
  { id: 'approvals', label: 'Approvals and safety', icon: 'i-lucide-shield-check' },
  { id: 'powers', label: 'Powers', icon: 'i-lucide-zap' },
  { id: 'data', label: 'Data controls', icon: 'i-lucide-database' }
]
const HEADINGS: Record<string, { title: string, text: string }> = {
  account: { title: 'Account', text: 'Who you are and how you sign in.' },
  plan: { title: 'Plan and usage', text: 'What you have used and what is left.' },
  appearance: { title: 'Appearance', text: 'How OpenLobs looks on this device.' },
  defaults: { title: 'Defaults', text: 'How new chats start. Kept on this device.' },
  voice: { title: 'Voice', text: 'How Lobby sounds when it talks.' },
  notifications: { title: 'Notifications', text: 'How OpenLobs reaches you when you are away.' },
  approvals: { title: 'Approvals and safety', text: 'What OpenLobs always asks about first, and where you manage what it can reach.' },
  powers: { title: 'Powers', text: 'What the assistant may use at all. Off means it is not even offered.' },
  data: { title: 'Data controls', text: 'Take your data, or remove it.' }
}
// The section lives in the address (/settings?s=powers) so a link can open it.
const section = computed({
  get: () => SECTIONS.some(x => x.id === route.query.s) ? String(route.query.s) : 'account',
  set: (id: string) => { void router.replace({ query: id === 'account' ? {} : { s: id } }) }
})
const heading = computed(() => HEADINGS[section.value]!)
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 md:py-14">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Settings</h1>

      <StateCard v-if="!loggedIn" class="mt-8" icon="i-lucide-lock" title="Sign in to see your settings" text="Settings belong to your account, so only you can see them.">
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </StateCard>

      <div v-else class="mt-6 flex flex-col gap-5 md:mt-10 md:flex-row md:gap-12">
        <SettingsNav v-model="section" :sections="SECTIONS" />

        <section :key="section" class="min-w-0 max-w-2xl flex-1" :aria-labelledby="`s-${section}`">
          <h2 :id="`s-${section}`" class="text-xl font-semibold text-highlighted">{{ heading.title }}</h2>
          <p class="mt-1 text-sm text-muted">{{ heading.text }}</p>

          <!-- Account -->
          <template v-if="section === 'account'">
            <div class="mt-6 flex items-center gap-4">
              <UAvatar :src="user?.avatar || undefined" :alt="user?.name" size="xl" />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">{{ user?.name }}</p>
                <p class="truncate text-xs text-muted">{{ user?.email || 'No email on this account' }}</p>
              </div>
            </div>
            <form class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="saveName">
              <UFormField label="Display name" class="flex-1">
                <UInput v-model="name" class="w-full" maxlength="60" autocomplete="name" />
              </UFormField>
              <UButton type="submit" label="Save" color="neutral" :loading="savingName" :disabled="!nameChanged" />
            </form>
            <div class="mt-6 divide-y divide-default border-y border-default">
              <SettingRow title="Sign-in method" :hint="methodLabel">
                <UIcon :name="methodIcon" class="size-5 text-muted" />
                <UButton v-if="signInMethod === 'password'" label="Reset password" icon="i-lucide-key-round" color="neutral" variant="subtle" size="sm" :loading="resetting" @click="resetPassword" />
              </SettingRow>
              <SettingRow title="Sign out" hint="Ends your session in this browser.">
                <UButton label="Log out" icon="i-lucide-log-out" color="neutral" variant="subtle" size="sm" @click="logOut" />
              </SettingRow>
            </div>
            <p class="mt-8 text-xs text-dimmed">
              <RouterLink to="/terms" class="underline underline-offset-2 hover:text-muted">Terms of use</RouterLink>
              ·
              <RouterLink to="/privacy" class="underline underline-offset-2 hover:text-muted">Privacy policy</RouterLink>
            </p>
          </template>

          <!-- Plan and usage -->
          <template v-else-if="section === 'plan'">
            <div class="mt-6">
              <div v-if="usageError" class="flex items-center justify-between gap-4">
                <p class="text-sm text-muted">{{ usageError }}</p>
                <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" size="sm" :loading="loadingUsage" @click="fetchUsage" />
              </div>
              <div v-else-if="!usage" class="flex justify-center py-6">
                <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
              </div>
              <template v-else>
                <div class="mb-5 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <UBadge :label="usage.limits.label + ' plan'" :color="usage.plan === 'pro' ? 'primary' : 'neutral'" variant="subtle" />
                    <span v-if="usage.unlimited" class="text-xs text-muted">No limits on this account</span>
                  </div>
                  <p v-if="usage.plan === 'pro' && usage.planEndsAt" class="text-xs text-muted">Pro until {{ day(usage.planEndsAt) }}</p>
                  <p v-else-if="usage.plan === 'pro'" class="text-xs text-muted">Pro, no end date</p>
                  <p v-else-if="billingFailed" class="text-xs text-muted">
                    Plans could not be loaded.
                    <button type="button" class="underline underline-offset-2 hover:text-highlighted" @click="fetchBilling">Retry</button>
                  </p>
                  <p v-else-if="billing && !billing.enabled" class="text-xs text-muted">Pro plans are coming soon.</p>
                </div>
                <div v-if="billing?.enabled && !usage.unlimited && !(usage.plan === 'pro' && !usage.planEndsAt)" class="mb-5 rounded-xl border border-default bg-elevated/40 p-4">
                  <p class="text-sm font-medium text-highlighted">{{ usage.plan === 'pro' ? 'Add more Pro time' : 'Upgrade to Pro' }}</p>
                  <p class="mb-3 mt-0.5 text-xs leading-snug text-muted">Pay once by card or mobile money. Time you buy is added to what you have left, and nothing renews by itself.</p>
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      v-for="o in billing.options"
                      :key="o.period"
                      :label="`${o.label} · ${money(o.price, billing.currency)}`"
                      :loading="buying === o.period"
                      :disabled="buying !== null"
                      color="neutral"
                      :variant="o.period === 'year' ? 'solid' : 'subtle'"
                      size="sm"
                      @click="buy(o.period)"
                    />
                  </div>
                </div>
                <div v-if="!usage.unlimited" class="flex flex-col gap-5">
                  <div>
                    <div class="mb-1.5 flex items-baseline justify-between">
                      <p class="text-sm text-highlighted">Today</p>
                      <p class="text-xs tabular-nums text-muted">{{ fmt(usage.usedToday) }} of {{ fmt(usage.limits.daily) }} credits</p>
                    </div>
                    <UProgress :model-value="pct(usage.usedToday, usage.limits.daily)" :color="barColor(pct(usage.usedToday, usage.limits.daily))" size="sm" aria-label="Credits used today" />
                    <p class="mt-1.5 text-xs text-dimmed">{{ resetsLabel(usage.dayResetsAt, 'day') }}</p>
                  </div>
                  <div>
                    <div class="mb-1.5 flex items-baseline justify-between">
                      <p class="text-sm text-highlighted">This month</p>
                      <p class="text-xs tabular-nums text-muted">{{ fmt(usage.usedMonth) }} of {{ fmt(usage.limits.monthly) }} credits</p>
                    </div>
                    <UProgress :model-value="pct(usage.usedMonth, usage.limits.monthly)" :color="barColor(pct(usage.usedMonth, usage.limits.monthly))" size="sm" aria-label="Credits used this month" />
                    <p class="mt-1.5 text-xs text-dimmed">{{ resetsLabel(usage.monthResetsAt, 'month') }}</p>
                  </div>
                </div>
                <p class="mt-5 text-xs leading-relaxed text-dimmed">
                  A normal message costs 1 credit; some models cost more. Workflow steps and the workflow assistant use credits too.
                  <template v-if="usage.tokens.input || usage.tokens.output"> This month the assistant read {{ fmt(usage.tokens.input) }} tokens and wrote {{ fmt(usage.tokens.output) }}.</template>
                </p>
              </template>
            </div>

            <template v-if="billing?.payments?.length">
              <h3 class="mt-8 text-xs font-medium uppercase tracking-wider text-muted">Payments</h3>
              <ul class="mt-2 divide-y divide-default border-y border-default">
                <li v-for="p in billing.payments" :key="p.reference" class="flex items-center justify-between gap-4 py-3">
                  <div class="min-w-0">
                    <p class="text-sm text-highlighted">{{ p.months }} month{{ p.months === 1 ? '' : 's' }} of Pro</p>
                    <p class="truncate text-xs text-muted">{{ day(p.paidAt) }} · <span class="font-mono">{{ p.reference }}</span></p>
                  </div>
                  <p class="shrink-0 text-sm tabular-nums text-highlighted">{{ money(p.amount, p.currency, true) }}</p>
                </li>
              </ul>
            </template>
          </template>

          <!-- Appearance -->
          <template v-else-if="section === 'appearance'">
            <div class="mt-4 divide-y divide-default border-y border-default">
              <div class="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p class="text-sm font-medium text-highlighted">Theme</p>
                  <p class="text-xs text-muted">System follows your phone or computer.</p>
                </div>
                <div class="flex gap-1.5" role="group" aria-label="Theme">
                  <UButton
                    v-for="m in modes"
                    :key="m.value"
                    :label="m.label"
                    :icon="m.icon"
                    size="sm"
                    color="neutral"
                    :variant="colorMode === m.value ? 'solid' : 'subtle'"
                    :aria-pressed="colorMode === m.value"
                    @click="colorMode = m.value"
                  />
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p class="text-sm font-medium text-highlighted">Accent colour</p>
                  <p class="text-xs text-muted">Buttons, links and the focus ring.</p>
                </div>
                <div class="flex gap-2" role="group" aria-label="Accent colour">
                  <button
                    v-for="a in ACCENTS"
                    :key="a.value"
                    type="button"
                    class="size-7 rounded-full ring-offset-2 ring-offset-default transition-shadow focus-visible:outline-2 focus-visible:outline-primary"
                    :class="[a.swatch, appearance.accent === a.value ? 'ring-2 ring-highlighted' : 'hover:ring-2 hover:ring-accented']"
                    :aria-label="a.label"
                    :aria-pressed="appearance.accent === a.value"
                    @click="appearance.accent = a.value"
                  />
                </div>
              </div>

              <div v-for="row in appearanceRows" :key="row.key" class="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p class="text-sm font-medium text-highlighted">{{ row.title }}</p>
                  <p class="text-xs text-muted">{{ row.hint }}</p>
                </div>
                <div class="flex gap-1.5" role="group" :aria-label="row.title">
                  <UButton
                    v-for="o in row.options"
                    :key="o.value"
                    :label="o.label"
                    size="sm"
                    color="neutral"
                    :variant="appearance[row.key] === o.value ? 'solid' : 'subtle'"
                    :aria-pressed="appearance[row.key] === o.value"
                    @click="(appearance as Record<string, string>)[row.key] = o.value"
                  />
                </div>
              </div>
            </div>
            <div class="pt-2">
              <UButton label="Back to the defaults" color="neutral" variant="link" size="xs" class="px-0" @click="resetAppearance" />
            </div>
          </template>

          <DefaultsSection v-else-if="section === 'defaults'" class="mt-4" />

          <LobbyVoiceSettings v-else-if="section === 'voice'" class="mt-4" />

          <!-- Notifications -->
          <template v-else-if="section === 'notifications'">
            <div class="mt-4 divide-y divide-default border-y border-default">
              <SettingRow title="Alerts on this device" hint="A pop-up on this phone or computer when a task is done, the assistant is waiting for you, or a workflow needs your OK. Works even when OpenLobs is closed.">
                <USwitch :model-value="alertsOn" :loading="alertsBusy" :disabled="alertsBusy || alertsCannot" aria-label="Alerts on this device" @update:model-value="setAlerts(Boolean($event))" />
                <template #extra>
                  <button v-if="alertsOn" type="button" class="mt-1.5 rounded text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary" @click="sendTest">Send a test alert</button>
                  <p v-if="testSent === 'sent'" class="mt-1 text-xs text-dimmed" role="status">Sent. It should arrive in a moment.</p>
                  <p v-else-if="testSent === 'none'" class="mt-1 text-xs text-warning" role="status">No device is signed up for alerts yet.</p>
                  <p v-if="alertsError" class="mt-1 text-xs text-error" role="alert">{{ alertsError }}</p>
                  <p v-else-if="alertsHint" class="mt-1 text-xs leading-snug text-dimmed">{{ alertsHint }}</p>
                </template>
              </SettingRow>
              <SettingRow title="Pro plan ending" hint="An email a few days before your Pro time runs out.">
                <USwitch :model-value="notifications?.emailRenewals !== false" :disabled="!notifications" aria-label="Email when Pro is ending" @update:model-value="setNotification('emailRenewals', Boolean($event))" />
              </SettingRow>
              <SettingRow title="Scheduled workflow failed" hint="An email when a scheduled run fails, at most once a day for each workflow.">
                <USwitch :model-value="notifications?.emailWorkflowFailures !== false" :disabled="!notifications" aria-label="Email when a scheduled workflow fails" @update:model-value="setNotification('emailWorkflowFailures', Boolean($event))" />
              </SettingRow>
              <SettingRow title="Task finished" hint="An email when a task that took a couple of minutes or more ends, so you can leave it running.">
                <USwitch :model-value="notifications?.emailTaskResults !== false" :disabled="!notifications" aria-label="Email when a task finishes" @update:model-value="setNotification('emailTaskResults', Boolean($event))" />
              </SettingRow>
              <SettingRow title="Assistant needs you" hint="An email when the assistant's browser is waiting for you (a sign-in, a code or an OK) and you are not looking at it.">
                <USwitch :model-value="notifications?.emailNeedsYou !== false" :disabled="!notifications" aria-label="Email when the assistant needs me" @update:model-value="setNotification('emailNeedsYou', Boolean($event))" />
              </SettingRow>
            </div>
            <p class="mt-3 text-xs leading-snug text-dimmed">
              <template v-if="notifications && notifications.emailAvailable === false">Email sending is not switched on for this server yet, so these will start once it is.</template>
              <template v-else-if="notifications?.email">Sent to {{ notifications.email }}. Payment receipts are always sent.</template>
              <template v-else>Your account has no email address, so no emails can be sent.</template>
            </p>
          </template>

          <ApprovalsSection v-else-if="section === 'approvals'" @go="section = $event" />

          <PowersSection v-else-if="section === 'powers'" />

          <DataSection v-else-if="section === 'data'" />
        </section>
      </div>
    </div>
  </div>
</template>
