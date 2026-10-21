<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useColorMode } from '@vueuse/core'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'
import { useAccount } from '../composables/useAccount'

const ModalDeleteAccount = defineAsyncComponent(() => import('../components/settings/ModalDeleteAccount.vue'))

const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const colorMode = useColorMode()
const { openAuthModal, firebaseUser, signInMethod, sendPasswordReset, updateDisplayName, signOutUser } = useFirebaseAuth()
const { user, loggedIn, clearSession } = useUserSession()
const { usage, usageError, loadingUsage, fetchUsage, downloadExport } = useAccount()

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

// The signed-in state is the server session, which is what every API call here is checked against.
onMounted(() => { if (loggedIn.value) fetchUsage() })
watch(loggedIn, (v) => { if (v) fetchUsage() })

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

// ---- Your data ----
const exporting = ref(false)
async function exportData() {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadExport()
    toast.add({ title: 'Your data is downloading', icon: 'i-lucide-download', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not export your data', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    exporting.value = false
  }
}

const deleteModal = overlay.create(ModalDeleteAccount)
async function deleteAccount() {
  const deleted = await deleteModal.open().result
  if (!deleted) return
  // The account no longer exists, so signing out only clears this browser.
  await signOutUser().catch(() => {})
  await clearSession()
  toast.add({ title: 'Your account was deleted', description: 'Everything was removed. Thanks for trying OpenLobs.', icon: 'i-lucide-check', color: 'neutral', duration: 10000 })
  router.push('/')
}

const modes = [
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
  { value: 'auto', label: 'System', icon: 'i-lucide-monitor' }
] as const

const LINKS = [
  { to: '/memory', icon: 'i-lucide-brain', title: 'Memory', detail: 'Notes OpenLobs keeps about you. Add, edit, or switch memory off.' },
  { to: '/agents', icon: 'i-lucide-bot', title: 'Agents', detail: 'Your saved agents, what each can use, and which skills they follow.' },
  { to: '/integrations', icon: 'i-lucide-blocks', title: 'Connected apps', detail: 'Connect or disconnect Google, Microsoft, Slack and more.' },
  { to: '/integrations/mcp', icon: 'i-lucide-plug', title: 'MCP servers', detail: 'Tools from servers you add, each approved by you first.' },
  { to: '/workflows', icon: 'i-lucide-workflow', title: 'Workflows', detail: 'Automations and their schedules.' }
]
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Settings</h1>
        <p class="text-muted text-base md:text-lg">Your account, your usage, and your data, all in one place.</p>
      </div>

      <div v-if="!loggedIn" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to see your settings</h2>
        <p class="text-sm text-muted mb-5">Settings belong to your account, so only you can see them.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div v-else class="flex flex-col gap-8">
        <!-- Profile -->
        <section aria-labelledby="s-profile">
          <h2 id="s-profile" class="text-sm font-semibold text-highlighted mb-3">Profile</h2>
          <div class="rounded-2xl border border-default bg-default p-4 sm:p-5">
            <div class="flex items-center gap-4 mb-5">
              <UAvatar :src="user?.avatar || undefined" :alt="user?.name" size="xl" />
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted truncate">{{ user?.name }}</p>
                <p class="text-xs text-muted truncate">{{ user?.email || 'No email on this account' }}</p>
              </div>
            </div>
            <form class="flex flex-col sm:flex-row gap-2 sm:items-end" @submit.prevent="saveName">
              <UFormField label="Display name" class="flex-1">
                <UInput v-model="name" class="w-full" maxlength="60" autocomplete="name" />
              </UFormField>
              <UButton type="submit" label="Save" color="neutral" :loading="savingName" :disabled="!nameChanged" />
            </form>
          </div>
        </section>

        <!-- Plan and usage -->
        <section aria-labelledby="s-usage">
          <h2 id="s-usage" class="text-sm font-semibold text-highlighted mb-3">Plan and usage</h2>
          <div class="rounded-2xl border border-default bg-default p-4 sm:p-5">
            <div v-if="usageError" class="flex items-center justify-between gap-4">
              <p class="text-sm text-muted">{{ usageError }}</p>
              <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" size="sm" :loading="loadingUsage" @click="fetchUsage" />
            </div>
            <div v-else-if="!usage" class="py-6 flex justify-center">
              <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
            </div>
            <template v-else>
              <div class="flex items-center justify-between gap-3 mb-5">
                <div class="flex items-center gap-2">
                  <UBadge :label="usage.limits.label + ' plan'" :color="usage.plan === 'pro' ? 'primary' : 'neutral'" variant="subtle" />
                  <span v-if="usage.unlimited" class="text-xs text-muted">No limits on this account</span>
                </div>
                <p v-if="usage.plan !== 'pro'" class="text-xs text-muted">Pro plans are coming soon.</p>
              </div>
              <div v-if="!usage.unlimited" class="flex flex-col gap-5">
                <div>
                  <div class="flex items-baseline justify-between mb-1.5">
                    <p class="text-sm text-highlighted">Today</p>
                    <p class="text-xs text-muted tabular-nums">{{ fmt(usage.usedToday) }} of {{ fmt(usage.limits.daily) }} credits</p>
                  </div>
                  <UProgress :model-value="pct(usage.usedToday, usage.limits.daily)" :color="barColor(pct(usage.usedToday, usage.limits.daily))" size="sm" aria-label="Credits used today" />
                  <p class="text-xs text-dimmed mt-1.5">{{ resetsLabel(usage.dayResetsAt, 'day') }}</p>
                </div>
                <div>
                  <div class="flex items-baseline justify-between mb-1.5">
                    <p class="text-sm text-highlighted">This month</p>
                    <p class="text-xs text-muted tabular-nums">{{ fmt(usage.usedMonth) }} of {{ fmt(usage.limits.monthly) }} credits</p>
                  </div>
                  <UProgress :model-value="pct(usage.usedMonth, usage.limits.monthly)" :color="barColor(pct(usage.usedMonth, usage.limits.monthly))" size="sm" aria-label="Credits used this month" />
                  <p class="text-xs text-dimmed mt-1.5">{{ resetsLabel(usage.monthResetsAt, 'month') }}</p>
                </div>
              </div>
              <p class="text-xs text-dimmed mt-5 leading-relaxed">
                A normal message costs 1 credit; some models cost more. Workflow steps and the workflow assistant use credits too.
                <template v-if="usage.tokens.input || usage.tokens.output"> This month the assistant read {{ fmt(usage.tokens.input) }} tokens and wrote {{ fmt(usage.tokens.output) }}.</template>
              </p>
            </template>
          </div>
        </section>

        <!-- Assistant -->
        <section aria-labelledby="s-assistant">
          <h2 id="s-assistant" class="text-sm font-semibold text-highlighted mb-3">Your assistant</h2>
          <ul class="rounded-2xl border border-default bg-default divide-y divide-default overflow-hidden">
            <li v-for="link in LINKS" :key="link.to">
              <RouterLink :to="link.to" class="flex items-center gap-3 px-4 py-3.5 hover:bg-elevated/60 transition-colors outline-primary/25 focus-visible:outline-2 focus-visible:-outline-offset-2">
                <div class="size-8 shrink-0 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center">
                  <UIcon :name="link.icon" class="size-4 text-primary" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-highlighted">{{ link.title }}</p>
                  <p class="text-xs text-muted leading-snug">{{ link.detail }}</p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed shrink-0" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <!-- Appearance -->
        <section aria-labelledby="s-appearance">
          <h2 id="s-appearance" class="text-sm font-semibold text-highlighted mb-3">Appearance</h2>
          <div class="rounded-2xl border border-default bg-default p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-highlighted">Theme</p>
              <p class="text-xs text-muted">Colours can also be changed from your name menu in the sidebar.</p>
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
        </section>

        <!-- Security -->
        <section aria-labelledby="s-security">
          <h2 id="s-security" class="text-sm font-semibold text-highlighted mb-3">Security</h2>
          <div class="rounded-2xl border border-default bg-default divide-y divide-default">
            <div class="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div class="flex items-center gap-3 min-w-0">
                <UIcon :name="methodIcon" class="size-5 text-muted shrink-0" />
                <div class="min-w-0">
                  <p class="text-sm font-medium text-highlighted">Sign-in method</p>
                  <p class="text-xs text-muted">{{ methodLabel }}</p>
                </div>
              </div>
              <UButton v-if="signInMethod === 'password'" label="Reset password" icon="i-lucide-key-round" color="neutral" variant="subtle" size="sm" :loading="resetting" @click="resetPassword" />
            </div>
            <div class="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-highlighted">Sign out</p>
                <p class="text-xs text-muted">Ends your session in this browser.</p>
              </div>
              <UButton label="Log out" icon="i-lucide-log-out" color="neutral" variant="subtle" size="sm" @click="logOut" />
            </div>
          </div>
        </section>

        <!-- Your data -->
        <section aria-labelledby="s-data">
          <h2 id="s-data" class="text-sm font-semibold text-highlighted mb-3">Your data</h2>
          <div class="rounded-2xl border border-default bg-default divide-y divide-default">
            <div class="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-highlighted">Download your data</p>
                <p class="text-xs text-muted leading-snug">Chats, workflows, agents, memory and more, as one file. Passwords and tokens are never included.</p>
              </div>
              <UButton label="Download" icon="i-lucide-download" color="neutral" variant="subtle" size="sm" :loading="exporting" @click="exportData" />
            </div>
            <div class="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-error">Delete account</p>
                <p class="text-xs text-muted leading-snug">Removes your account and everything in it, for good.</p>
              </div>
              <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="subtle" size="sm" @click="deleteAccount" />
            </div>
          </div>
        </section>

        <p class="text-xs text-dimmed text-center">
          <RouterLink to="/terms" class="underline underline-offset-2 hover:text-muted">Terms of use</RouterLink>
          ·
          <RouterLink to="/privacy" class="underline underline-offset-2 hover:text-muted">Privacy policy</RouterLink>
        </p>
      </div>
    </div>
  </div>
</template>
