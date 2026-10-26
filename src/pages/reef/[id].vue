<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import { accentGradient } from '../../utils/accentGradient'
import { timeAgo } from '../../utils/taskTime'
import ReefFindings from '../../components/reef/ReefFindings.vue'
import { REPORT_REASONS } from '../../types/reef'
import type { SharedItem } from '../../types/reef'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { getShare, install, report } = useReef()

const id = computed(() => String(route.params.id ?? ''))
const item = ref<SharedItem | null>(null)
useHead({ title: computed(() => (item.value ? `${item.value.title} · The Reef` : 'The Reef')) })
const loading = ref(true)
const loadError = ref<string | null>(null)
const notFound = ref(false)

onMounted(async () => {
  try {
    item.value = await getShare(id.value)
  } catch (err: any) {
    notFound.value = Boolean(err?.notFound)
    loadError.value = err?.message || 'Could not load this page.'
  } finally {
    loading.value = false
  }
})

// Groups that reach into accounts stay off unless the person ticks them.
const allow = ref<string[]>([])
const toggle = (gid: string, on: boolean) => { allow.value = on ? [...new Set([...allow.value, gid])] : allow.value.filter(x => x !== gid) }
const safe = computed(() => item.value?.needs.filter(n => !n.sensitive) ?? [])
const sensitive = computed(() => item.value?.needs.filter(n => n.sensitive) ?? [])

const installing = ref(false)
const installError = ref<string | null>(null)
const installed = ref<{ name: string, withheld: string[], dropped: string[] } | null>(null)

async function doInstall() {
  if (!item.value || installing.value) return
  if (!loggedIn.value) return openAuthModal()
  installing.value = true
  installError.value = null
  try {
    const res = await install(item.value.id, allow.value)
    installed.value = { name: res.agent.name, withheld: res.withheld.map(w => w.label), dropped: res.droppedSkills }
    item.value = { ...item.value, installs: item.value.installs + 1 }
  } catch (err: any) {
    installError.value = err?.message || 'Could not install. Try again.'
  } finally {
    installing.value = false
  }
}

const showAll = ref(false)
const long = computed(() => (item.value?.payload.instructions.length ?? 0) > 700)

const reporting = ref(false)
const reason = ref('secret')
const note = ref('')
const sending = ref(false)
async function sendReport() {
  if (!loggedIn.value) return openAuthModal()
  sending.value = true
  try {
    await report(id.value, reason.value, note.value.trim())
    reporting.value = false
    toast.add({ title: 'Thank you. We will look at it.', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not send the report', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div v-if="loading" class="py-24 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="loadError || !item" class="rounded-2xl border border-default bg-elevated/50 p-10 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon :name="notFound ? 'i-lucide-waves' : 'i-lucide-cloud-off'" class="size-5 text-muted" />
        </div>
        <h1 class="text-base font-semibold text-highlighted mb-1">{{ notFound ? 'Nothing here' : 'Could not load this page' }}</h1>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Go home" icon="i-lucide-house" color="neutral" variant="subtle" @click="router.push('/')" />
      </div>

      <template v-else>
        <!-- Header -->
        <div class="rounded-3xl border border-default overflow-hidden mb-8">
          <div class="px-6 sm:px-8 py-8 sm:py-10" :class="accentGradient(item.title)">
            <p class="text-xs font-medium uppercase tracking-widest text-muted mb-3 flex items-center gap-1.5"><UIcon name="i-lucide-waves" class="size-3.5" />The Reef · Agent</p>
            <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">{{ item.title }}</h1>
            <p v-if="item.description" class="text-base text-default/80 max-w-xl">{{ item.description }}</p>
            <p class="text-sm text-muted mt-5">
              By <span class="font-medium text-default">{{ item.authorName }}</span> · version {{ item.version }} · {{ item.installs }} {{ item.installs === 1 ? 'copy' : 'copies' }} installed · updated {{ timeAgo(item.updatedAt) }}
            </p>
          </div>
        </div>

        <ReefFindings v-if="item.scan.verdict === 'review'" :scan="item.scan" mode="review" class="mb-8" />

        <!-- What it needs -->
        <section class="mb-8" aria-labelledby="needs">
          <h2 id="needs" class="text-sm font-semibold text-highlighted mb-1">What it can do</h2>
          <p class="text-xs text-muted mb-3">Nothing runs until you start a chat with it. Anything that reaches into your accounts is off until you switch it on.</p>
          <ul class="divide-y divide-default rounded-2xl border border-default overflow-hidden">
            <li v-for="n in safe" :key="n.id" class="flex items-start gap-3 px-4 py-3">
              <UIcon name="i-lucide-check" class="size-4 mt-0.5 text-success shrink-0" />
              <div class="min-w-0"><p class="text-sm text-highlighted">{{ n.label }}</p><p class="text-xs text-muted">{{ n.detail }}</p></div>
            </li>
            <li v-for="n in sensitive" :key="n.id" class="flex items-start gap-3 px-4 py-3 bg-warning/5">
              <UIcon name="i-lucide-shield-alert" class="size-4 mt-0.5 text-warning shrink-0" />
              <div class="min-w-0 flex-1"><p class="text-sm text-highlighted">{{ n.label }}</p><p class="text-xs text-muted">{{ n.detail }}</p></div>
              <label class="flex items-center gap-2 text-xs text-muted shrink-0">
                Allow
                <USwitch :model-value="allow.includes(n.id)" :aria-label="`Allow: ${n.label}`" @update:model-value="toggle(n.id, Boolean($event))" />
              </label>
            </li>
            <li v-if="!item.needs.length" class="px-4 py-3 text-sm text-muted">It uses no tools. It only writes replies.</li>
          </ul>
          <p v-if="item.payload.skills.length" class="text-xs text-muted mt-3">Skills it loads: {{ item.payload.skills.join(', ') }}</p>
        </section>

        <!-- Instructions -->
        <section class="mb-8" aria-labelledby="instr">
          <h2 id="instr" class="text-sm font-semibold text-highlighted mb-1">Its instructions</h2>
          <p class="text-xs text-muted mb-3">This is everything it is told to do. Read it before you install it.</p>
          <div class="rounded-2xl border border-default bg-elevated/40 p-4 sm:p-5 relative">
            <p class="text-sm text-default whitespace-pre-wrap leading-relaxed" :class="long && !showAll ? 'max-h-48 overflow-hidden' : ''">{{ item.payload.instructions }}</p>
            <div v-if="long && !showAll" class="absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-t from-default to-transparent pointer-events-none" />
          </div>
          <UButton v-if="long" :label="showAll ? 'Show less' : 'Show all'" size="xs" color="neutral" variant="ghost" class="mt-2" @click="showAll = !showAll" />
        </section>

        <!-- Install -->
        <div v-if="installed" class="rounded-2xl border border-success/30 bg-success/5 p-5">
          <p class="text-sm font-semibold text-highlighted flex items-center gap-2"><UIcon name="i-lucide-circle-check" class="size-4 text-success" />Added to your agents</p>
          <p class="text-sm text-muted mt-1">“{{ installed.name }}” is now your own copy. Change anything you like.</p>
          <p v-if="installed.withheld.length" class="text-xs text-muted mt-2">Switched off: {{ installed.withheld.join(', ') }}. You can turn them on in the agent's settings.</p>
          <p v-if="installed.dropped.length" class="text-xs text-muted mt-1">Skills this app does not have, left out: {{ installed.dropped.join(', ') }}.</p>
          <div class="flex gap-2 mt-4">
            <UButton label="Open my agents" icon="i-lucide-bot" color="neutral" @click="router.push('/agents')" />
          </div>
        </div>
        <div v-else class="flex flex-wrap items-center gap-3">
          <UButton :label="loggedIn ? 'Add to my agents' : 'Sign in to add'" :icon="loggedIn ? 'i-lucide-plus' : 'i-lucide-log-in'" color="neutral" size="lg" :loading="installing" @click="doInstall" />
          <p class="text-xs text-muted">You get your own copy. It does not change if the author edits theirs.</p>
        </div>
        <p v-if="installError" class="text-xs text-error mt-3" role="alert">{{ installError }}</p>

        <div class="mt-12 pt-5 border-t border-default flex items-center justify-between">
          <p class="text-xs text-dimmed">Made by a person, not checked by OpenLobs beyond an automatic scan.</p>
          <UButton label="Report" icon="i-lucide-flag" size="xs" color="neutral" variant="ghost" @click="reporting = !reporting" />
        </div>
        <div v-if="reporting" class="mt-3 rounded-2xl border border-default p-4 space-y-3">
          <UFormField label="What is wrong?" size="sm">
            <USelect v-model="reason" :items="REPORT_REASONS" class="w-full" />
          </UFormField>
          <UFormField label="Anything we should know? (optional)" size="sm">
            <UTextarea v-model="note" :rows="2" :maxlength="300" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="reporting = false" />
            <UButton label="Send report" color="neutral" size="sm" :loading="sending" @click="sendReport" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
