<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { cloudError } from '../../composables/useCloudWhere'
import type { CloudOverview, CloudPlace } from '../../composables/useCloudWhere'
import Reveal from '../state/Reveal.vue'

// "Where it runs", under the cloud switch in Settings > Powers: the person's own GitHub or the OpenLobs box.
// GitHub is theirs: a private repo they make, a token that reaches only that repo, their own free minutes.
// The token is pasted once, checked on the server, stored sealed, and never shown again.
const props = defineProps<{
  overview: CloudOverview
  connect: (token: string) => Promise<void>
  check: () => Promise<void>
  disconnect: () => Promise<void>
  choose: (where: CloudPlace) => Promise<void>
}>()

const toast = useToast()
const REPO_URL = 'https://github.com/new?name=openlobs-runs&visibility=private&description=Where+OpenLobs+runs+short+jobs+for+me'
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=OpenLobs+runs&description=Lets+OpenLobs+send+short+jobs+to+openlobs-runs+only&expires_in=365&actions=write&contents=write&workflows=write'

const github = computed(() => props.overview.github)
const chosen = computed(() => props.overview.chosen)

const token = ref('')
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
const busy = ref<'connect' | 'check' | 'disconnect' | null>(null)
const problem = ref('')
const confirmOff = ref(false)

type Option = { key: CloudPlace, title: string, hint: string, state: 'chosen' | 'ready' | 'off' }
const options = computed<Option[]>(() => {
  const list: Option[] = [{
    key: 'github',
    title: 'Your GitHub',
    hint: 'A private repo of yours, on GitHub\'s machines. It uses your GitHub\'s free minutes, so it costs OpenLobs nothing and none of your credits.',
    state: chosen.value === 'github' ? 'chosen' : github.value.connected ? 'ready' : 'off'
  }]
  if (props.overview.box) {
    list.push({
      key: 'box',
      title: 'OpenLobs cloud box',
      hint: 'A fresh box that is deleted afterwards. Starts quicker. Each plan uses your credits.',
      state: chosen.value === 'box' ? 'chosen' : 'ready'
    })
  }
  return list
})
const CHIP: Record<Option['state'], string> = { chosen: 'Chosen', ready: 'Ready', off: 'Not set up' }

async function pick(o: Option) {
  problem.value = ''
  if (o.state === 'off') {
    await nextTick()
    document.getElementById('github-setup')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    ;(input.value?.inputRef ?? document.querySelector<HTMLInputElement>('#github-token'))?.focus({ preventScroll: true })
    return
  }
  if (o.state === 'chosen') return
  try { await props.choose(o.key) } catch (err) {
    toast.add({ title: 'Could not change that', description: cloudError(err), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

async function submit() {
  if (!token.value.trim() || busy.value) return
  busy.value = 'connect'
  problem.value = ''
  try {
    await props.connect(token.value.trim())
    token.value = ''
    toast.add({ title: 'Your GitHub is ready', description: 'Plans you approve now run there.', icon: 'i-lucide-check', color: 'success' })
  } catch (err) {
    problem.value = cloudError(err)
  } finally { busy.value = null }
}

async function recheck() {
  busy.value = 'check'
  problem.value = ''
  try {
    await props.check()
    toast.add({ title: 'Your GitHub checks out', icon: 'i-lucide-check', color: 'success' })
  } catch (err) {
    problem.value = cloudError(err)
  } finally { busy.value = null }
}

async function forget() {
  busy.value = 'disconnect'
  try {
    await props.disconnect()
    confirmOff.value = false
    toast.add({ title: 'Disconnected', description: 'The token is forgotten. Your openlobs-runs repo is still in your GitHub.', icon: 'i-lucide-unlink', color: 'neutral' })
  } catch (err) {
    toast.add({ title: 'Could not disconnect', description: cloudError(err), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally { busy.value = null }
}

const when = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return 'Not yet'
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const day = new Date(t)
  const clock = day.toLocaleTimeString(undefined, { timeStyle: 'short' })
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return `Today, ${clock}`
  if (days === 1) return `Yesterday, ${clock}`
  return day.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const lastRun = computed(() => {
  const r = github.value.lastRun
  return r ? `${when(r.at)}, ${Math.round(r.seconds)} s${r.ok ? '' : ', it failed'}` : 'Nothing yet'
})

const STEP = 'flex items-start justify-between gap-x-4 gap-y-3 py-3.5'
const CHIP_CLASS = 'rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider'
</script>

<template>
  <div class="pb-6 pt-4 sm:pl-4">
    <p class="text-xs font-medium uppercase tracking-wider text-muted">Where it runs</p>

    <div role="radiogroup" aria-label="Where it runs" class="mt-2 divide-y divide-default border-y border-default">
      <button
        v-for="o in options"
        :key="o.key"
        type="button"
        role="radio"
        :aria-checked="o.state === 'chosen'"
        class="group flex w-full items-start gap-3 py-3.5 text-left outline-primary/25 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2"
        @click="pick(o)"
      >
        <!-- the dot fills in when it is the one in use -->
        <span class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-200" :class="o.state === 'chosen' ? 'border-highlighted' : 'border-accented group-hover:border-muted'">
          <span class="size-2 rounded-full bg-inverted transition-transform duration-200" :class="o.state === 'chosen' ? 'scale-100' : 'scale-0'" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium text-highlighted">{{ o.title }}</span>
          <span class="mt-0.5 block text-xs leading-snug text-muted">{{ o.hint }}</span>
        </span>
        <span :class="[CHIP_CLASS, 'mt-0.5 shrink-0', o.state === 'chosen' ? 'bg-accented text-highlighted' : 'bg-accented/50 text-muted']">{{ CHIP[o.state] }}</span>
      </button>
    </div>

    <!-- Not set up: three steps, once -->
    <Reveal>
      <div v-if="!github.connected" id="github-setup" class="mt-6">
        <p class="text-sm font-medium text-highlighted">Set up your GitHub</p>
        <p class="mt-0.5 text-xs leading-snug text-muted">Two minutes, once. The token can reach only the repo you make here, never your other code.</p>
        <ol class="mt-3 divide-y divide-default border-y border-default text-sm">
          <li :class="STEP">
            <div class="flex min-w-0 flex-1 basis-60 gap-3">
              <span class="mt-px w-3 shrink-0 font-mono text-[11px] text-dimmed">1</span>
              <div class="min-w-0">
                <p class="text-highlighted">Make a private repo called <span class="font-mono text-[13px]">openlobs-runs</span></p>
                <p class="mt-0.5 text-xs leading-snug text-muted">Keep it empty and private, and put nothing else in it. Jobs run here, so it should hold nothing you care about.</p>
              </div>
            </div>
            <UButton label="Open GitHub" trailing-icon="i-lucide-arrow-up-right" color="neutral" variant="outline" size="sm" class="shrink-0" :to="REPO_URL" target="_blank" rel="noopener noreferrer" />
          </li>
          <li :class="STEP">
            <div class="flex min-w-0 flex-1 basis-60 gap-3">
              <span class="mt-px w-3 shrink-0 font-mono text-[11px] text-dimmed">2</span>
              <div class="min-w-0">
                <p class="text-highlighted">Make a token for that repo only</p>
                <p class="mt-0.5 text-xs leading-snug text-muted">
                  The button fills in the name and what it may do: <span class="font-mono text-[11px]">Actions</span>, <span class="font-mono text-[11px]">Contents</span> and <span class="font-mono text-[11px]">Workflows</span>, each read and write. You pick the rest on GitHub: <span class="text-default">Only select repositories</span>, then <span class="font-mono text-[11px]">openlobs-runs</span>. A year is a good length.
                </p>
              </div>
            </div>
            <UButton label="Make the token" trailing-icon="i-lucide-arrow-up-right" color="neutral" variant="outline" size="sm" class="shrink-0" :to="TOKEN_URL" target="_blank" rel="noopener noreferrer" />
          </li>
          <li class="py-3.5">
            <div class="flex gap-3">
              <span class="mt-px w-3 shrink-0 font-mono text-[11px] text-dimmed">3</span>
              <div class="min-w-0 flex-1">
                <p class="text-highlighted">Paste the token and check</p>
                <form class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="submit">
                  <UInput
                    id="github-token"
                    ref="input"
                    v-model="token"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="github_pat_..."
                    aria-label="GitHub token"
                    :aria-invalid="Boolean(problem)"
                    :disabled="busy === 'connect'"
                    class="min-w-0 flex-1 basis-60"
                    :ui="{ base: 'font-mono text-[13px]' }"
                  />
                  <UButton type="submit" label="Check" color="neutral" :loading="busy === 'connect'" :disabled="!token.trim()" />
                </form>
                <p v-if="problem" role="alert" class="mt-2 text-xs leading-snug text-error">{{ problem }}</p>
                <p v-else class="mt-2 text-xs leading-snug text-muted">Kept encrypted. It is used only to send jobs to that repo and read what they printed. Delete it on GitHub any time and OpenLobs loses access at once.</p>
              </div>
            </div>
          </li>
        </ol>
      </div>
    </Reveal>

    <!-- Set up -->
    <Reveal>
      <div v-if="github.connected" class="mt-6">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-highlighted">Your GitHub</p>
          <span :class="[CHIP_CLASS, 'bg-accented/50 text-muted']">Connected</span>
        </div>
        <dl class="mt-2 divide-y divide-default border-y border-default text-sm">
          <div class="flex items-center justify-between gap-4 py-3"><dt class="text-muted">Account</dt><dd class="min-w-0 truncate text-highlighted">{{ github.login }}</dd></div>
          <div class="flex items-center justify-between gap-4 py-3">
            <dt class="text-muted">Repo</dt>
            <dd class="flex min-w-0 items-center gap-2 text-highlighted"><span class="truncate">{{ github.repo }}</span><span :class="[CHIP_CLASS, 'bg-accented/50 text-muted']">Private</span></dd>
          </div>
          <div class="flex items-center justify-between gap-4 py-3"><dt class="text-muted">Last run</dt><dd class="text-highlighted">{{ lastRun }}</dd></div>
          <div class="flex items-center justify-between gap-4 py-3"><dt class="text-muted">Checked</dt><dd class="text-muted">{{ when(github.checkedAt) }}</dd></div>
        </dl>
        <p v-if="problem" role="alert" class="mt-3 text-xs leading-snug text-error">{{ problem }}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton label="Check again" color="neutral" variant="outline" size="sm" :loading="busy === 'check'" :disabled="busy === 'disconnect'" @click="recheck" />
          <template v-if="!confirmOff">
            <UButton label="Disconnect" color="neutral" variant="ghost" size="sm" :disabled="busy !== null" @click="confirmOff = true" />
          </template>
          <template v-else>
            <span class="text-xs text-muted">Forget the token?</span>
            <UButton label="Yes, disconnect" color="error" variant="soft" size="sm" :loading="busy === 'disconnect'" @click="forget" />
            <UButton label="Keep it" color="neutral" variant="ghost" size="sm" :disabled="busy === 'disconnect'" @click="confirmOff = false" />
          </template>
        </div>
      </div>
    </Reveal>

    <p class="mt-5 text-xs leading-relaxed text-dimmed">
      Each plan still asks first. GitHub Free includes 2,000 free minutes a month for private repos, and a short plan uses about a minute. OpenLobs deletes each run from your repo as soon as it has the result.
    </p>
  </div>
</template>
