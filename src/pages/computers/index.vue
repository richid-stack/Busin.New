<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBridge } from '../../composables/useBridge'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import { OPEN_JOB, PLATFORM_LABEL } from '../../types/bridge'
import type { BridgeJobItem, ComputerItem, PairingCode } from '../../types/bridge'
import { timeAgo } from '../../utils/taskTime'

const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { computers, loading, loaded, unauthorized, loadError, fetchComputers, newCode, startTest, getJob, cancelJob, disconnect } = useBridge()

onMounted(fetchComputers)
watch(loggedIn, fetchComputers)

// Online dots go stale quickly, so keep the list fresh while the page is open.
const refresh = setInterval(() => { if (!document.hidden) fetchComputers() }, 10_000)
onBeforeUnmount(() => { clearInterval(refresh); clearInterval(codeTimer); clearInterval(testTimer) })

// ---- Add a computer ----
const pairing = ref<PairingCode | null>(null)
const pairingError = ref<string | null>(null)
const making = ref(false)
const secondsLeft = ref(0)
let codeTimer: ReturnType<typeof setInterval> | undefined

const origin = computed(() => (typeof window === 'undefined' ? '' : window.location.origin))
const expired = computed(() => !!pairing.value && secondsLeft.value <= 0)
const clock = computed(() => `${Math.floor(secondsLeft.value / 60)}:${String(secondsLeft.value % 60).padStart(2, '0')}`)
const knownBefore = ref(0)

async function makeCode() {
  making.value = true
  pairingError.value = null
  try {
    pairing.value = await newCode()
    knownBefore.value = computers.value.length
    clearInterval(codeTimer)
    const tick = () => { secondsLeft.value = Math.max(0, Math.round((new Date(pairing.value!.expiresAt).getTime() - Date.now()) / 1000)) }
    tick()
    codeTimer = setInterval(() => {
      tick()
      fetchComputers()
      if (secondsLeft.value <= 0) clearInterval(codeTimer)
    }, 3000)
  } catch (err: any) {
    pairingError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not make a code. Try again.'
  } finally {
    making.value = false
  }
}

// When a new computer appears while a code is showing, the pairing worked.
watch(() => computers.value.length, (n) => {
  if (pairing.value && n > knownBefore.value) { pairing.value = null; clearInterval(codeTimer) }
})

const command = computed(() => `npm run bridge -- pair ${pairing.value?.code ?? 'CODE'} --server ${origin.value}`)
const copied = ref(false)
async function copyCommand() {
  try {
    await navigator.clipboard.writeText(command.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch { /* the command is shown on screen */ }
}

// ---- Test a connection ----
interface TestState { job: BridgeJobItem | null, starting: boolean, error: string | null }
const tests = ref<Record<string, TestState>>({})
let testTimer: ReturnType<typeof setInterval> | undefined

const stateOf = (id: string): TestState => tests.value[id] ?? { job: null, starting: false, error: null }
const setState = (id: string, patch: Partial<TestState>) => { tests.value = { ...tests.value, [id]: { ...stateOf(id), ...patch } } }

function pollTests() {
  clearInterval(testTimer)
  testTimer = setInterval(async () => {
    const open = Object.entries(tests.value).filter(([, s]) => s.job && OPEN_JOB.includes(s.job.status))
    if (!open.length) { clearInterval(testTimer); return }
    for (const [id, s] of open) {
      try { setState(id, { job: await getJob(s.job!.id) }) } catch { /* try again on the next beat */ }
    }
  }, 1500)
}

async function test(c: ComputerItem) {
  setState(c.id, { starting: true, error: null, job: null })
  try {
    setState(c.id, { job: await startTest(c.id), starting: false })
    pollTests()
  } catch (err: any) {
    setState(c.id, { starting: false, error: err?.data?.statusMessage || err?.statusMessage || 'Could not start the test.' })
  }
}

async function stopTest(id: string) {
  const job = stateOf(id).job
  if (!job) return
  try { setState(id, { job: await cancelJob(job.id) }) } catch { /* the job may already have finished */ }
}

function testLine(id: string): { tone: 'busy' | 'ok' | 'bad', text: string } | null {
  const s = stateOf(id)
  if (s.error) return { tone: 'bad', text: s.error }
  if (!s.job) return null
  const j = s.job
  if (j.status === 'queued') return { tone: 'busy', text: 'Waiting for the computer to pick it up…' }
  if (j.status === 'sent') return { tone: 'busy', text: 'The computer is answering…' }
  if (j.status === 'done') {
    const os = String(j.result?.osVersion || '')
    return { tone: 'ok', text: `It answered${os ? `: ${os}` : ''}. The connection works.` }
  }
  if (j.status === 'cancelled') return { tone: 'bad', text: 'Test cancelled.' }
  if (j.status === 'expired') return { tone: 'bad', text: 'No answer. Check that the Bridge is running on that computer.' }
  return { tone: 'bad', text: j.error || 'The computer could not answer.' }
}

// ---- Disconnect ----
const confirming = ref<string | null>(null)
const removing = ref<string | null>(null)
const removeError = ref<string | null>(null)
async function remove(c: ComputerItem) {
  if (confirming.value !== c.id) { confirming.value = c.id; return }
  removing.value = c.id
  removeError.value = null
  try {
    await disconnect(c.id)
    confirming.value = null
  } catch (err: any) {
    removeError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not disconnect. Try again.'
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-8">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Computers</h1>
        <p class="text-muted text-base md:text-lg">Connect a computer so OpenLobs can work with the apps on it. The connection only goes out from your computer, and OpenLobs can only ask for a short, fixed list of things.</p>
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to connect a computer</h2>
        <p class="text-sm text-muted mb-5">Computers are tied to your account, so only you can see and use them.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <template v-else>
        <div v-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
          <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your computers</h2>
          <p class="text-sm text-muted mb-5">{{ loadError }}</p>
          <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchComputers" />
        </div>

        <div v-else-if="!loaded" class="py-12 flex justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <template v-else>
          <section class="rounded-2xl border border-default bg-default">
            <div class="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5">
              <h2 class="text-sm font-semibold text-highlighted">Your computers</h2>
              <UButton v-if="!pairing" label="Add a computer" icon="i-lucide-plus" size="sm" color="neutral" :loading="making" @click="makeCode" />
            </div>

            <ul v-if="computers.length" class="divide-y divide-default border-t border-default">
              <li v-for="c in computers" :key="c.id" class="px-4 sm:px-5 py-4">
                <div class="flex items-start gap-3">
                  <span class="mt-1.5 size-2 rounded-full shrink-0" :class="c.online ? 'bg-success' : 'bg-accented'" :title="c.online ? 'Online' : 'Offline'" />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-highlighted truncate">{{ c.name }}</p>
                    <p class="text-xs text-muted">
                      {{ PLATFORM_LABEL[c.platform] }} ·
                      <span :class="c.online ? 'text-success' : ''">{{ c.online ? 'Online now' : c.lastSeenAt ? `Last seen ${timeAgo(c.lastSeenAt)}` : 'Not seen yet' }}</span>
                      · Bridge {{ c.bridgeVersion }}
                    </p>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <UButton v-if="stateOf(c.id).job && OPEN_JOB.includes(stateOf(c.id).job!.status)" label="Stop" size="xs" color="neutral" variant="ghost" @click="stopTest(c.id)" />
                    <UButton v-else label="Test" icon="i-lucide-activity" size="xs" color="neutral" variant="subtle" :loading="stateOf(c.id).starting" :disabled="!c.online" @click="test(c)" />
                    <UButton
                      :label="confirming === c.id ? 'Confirm' : 'Disconnect'"
                      size="xs"
                      :color="confirming === c.id ? 'error' : 'neutral'"
                      variant="ghost"
                      :loading="removing === c.id"
                      @click="remove(c)"
                      @blur="confirming = null"
                    />
                  </div>
                </div>
                <p v-if="testLine(c.id)" class="mt-2 ml-5 text-xs" :class="{ 'text-muted': testLine(c.id)!.tone === 'busy', 'text-success': testLine(c.id)!.tone === 'ok', 'text-error': testLine(c.id)!.tone === 'bad' }" role="status">
                  {{ testLine(c.id)!.text }}
                </p>
                <p v-if="confirming === c.id" class="mt-2 ml-5 text-xs text-muted">This stops that computer from connecting at once. You can pair it again later.</p>
              </li>
            </ul>

            <div v-else-if="!pairing" class="border-t border-default px-4 sm:px-5 py-10 text-center">
              <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-elevated/50 flex items-center justify-center">
                <UIcon name="i-lucide-monitor-smartphone" class="size-5 text-muted" />
              </div>
              <h3 class="text-base font-semibold text-highlighted mb-1">No computer connected</h3>
              <p class="text-sm text-muted">Add one to let OpenLobs work with apps on it. Windows is supported first.</p>
            </div>

            <div v-if="pairing" class="border-t border-default px-4 sm:px-5 py-5">
              <template v-if="!expired">
                <p class="text-xs font-medium uppercase tracking-wide text-muted mb-2">Your pairing code</p>
                <p class="font-mono text-3xl sm:text-4xl font-semibold tracking-[0.25em] text-highlighted select-all" aria-live="polite">{{ pairing.code }}</p>
                <p class="text-xs text-muted mt-2">Works once and expires in {{ clock }}.</p>

                <ol class="mt-5 space-y-3 text-sm text-muted list-decimal pl-5">
                  <li>On the computer, get the OpenLobs Bridge and open a terminal in its folder (Node 22 or newer).</li>
                  <li>
                    Run this:
                    <div class="mt-2 flex items-stretch gap-2">
                      <code class="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-elevated px-3 py-2 text-xs text-highlighted">{{ command }}</code>
                      <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" size="sm" color="neutral" variant="subtle" :aria-label="copied ? 'Copied' : 'Copy command'" @click="copyCommand" />
                    </div>
                  </li>
                  <li>Then start it with <code class="text-xs text-highlighted">npm run bridge -- run</code>. This page updates when it connects.</li>
                </ol>
              </template>
              <template v-else>
                <p class="text-sm text-muted mb-3">That code has expired.</p>
                <UButton label="Make a new code" icon="i-lucide-refresh-cw" size="sm" color="neutral" :loading="making" @click="makeCode" />
              </template>
              <div v-if="!expired" class="mt-5">
                <UButton label="Cancel" size="xs" color="neutral" variant="ghost" @click="pairing = null" />
              </div>
            </div>
            <p v-if="pairingError" class="border-t border-default px-4 sm:px-5 py-3 text-xs text-error" role="alert">{{ pairingError }}</p>
            <p v-if="removeError" class="border-t border-default px-4 sm:px-5 py-3 text-xs text-error" role="alert">{{ removeError }}</p>
          </section>

          <section class="mt-8 px-1">
            <h2 class="text-sm font-semibold text-highlighted mb-2">What the Bridge can and cannot do</h2>
            <ul class="space-y-1.5 text-sm text-muted list-disc pl-5">
              <li>It only calls out to OpenLobs. It opens no port on your computer.</li>
              <li>Right now it can answer one harmless ping. Nothing else, and nothing runs on its own.</li>
              <li>You can stop it any time, or disconnect it here. The connection ends at once.</li>
            </ul>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>
