<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import { BlockedShare, shareUrl, useReef } from '../../composables/useReef'
import type { ReefScan } from '../../types/reef'
import type { AgentProfile } from '../../types/agents'
import ReefFindings from './ReefFindings.vue'

const props = defineProps<{ agent: AgentProfile | null }>()
const open = defineModel<boolean>('open', { default: false })

const { mine, mineLoaded, fetchMine, share, unshare } = useReef()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

const busy = ref(false)
const error = ref<string | null>(null)
const blocked = ref<ReefScan | null>(null)

const existing = computed(() => (props.agent ? mine.value.find(s => s.agentId === props.agent!.id) ?? null : null))
const link = computed(() => (existing.value ? shareUrl(existing.value.id) : ''))

watch(open, async (isOpen) => {
  if (!isOpen) return
  error.value = null
  blocked.value = null
  await fetchMine()
})

async function publish() {
  if (!props.agent || busy.value) return
  busy.value = true
  error.value = null
  blocked.value = null
  try {
    await share(props.agent.id)
  } catch (err: any) {
    if (err instanceof BlockedShare) { blocked.value = err.scan; error.value = err.message } else error.value = err?.message || 'Could not share. Try again.'
  } finally {
    busy.value = false
  }
}

async function stop() {
  if (!existing.value || busy.value) return
  busy.value = true
  error.value = null
  try { await unshare(existing.value.id) } catch (err: any) { error.value = err?.message || 'Could not stop sharing.' } finally { busy.value = false }
}

const SHARED = ['Its name and description', 'Its instructions, in full, so people can read them first', 'Which tools and skills it uses', 'Your name, as the author']
const NEVER = ['The model or any key', 'Your chats and memory', 'Your connected apps and accounts']
</script>

<template>
  <UModal
    v-model:open="open"
    :title="agent ? `Share ${agent.name}` : 'Share'"
    description="Anyone with the link can read it. Only people who are signed in can install a copy."
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <div v-if="!mineLoaded" class="py-8 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else class="space-y-5">
        <div v-if="existing" class="space-y-3">
          <div class="flex items-center gap-2">
            <UInput :model-value="link" readonly class="flex-1" :ui="{ base: 'font-mono text-xs' }" aria-label="Share link" />
            <UButton :label="copied ? 'Copied' : 'Copy'" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="subtle" @click="copy(link)" />
          </div>
          <p class="text-xs text-muted">
            Version {{ existing.version }} · {{ existing.installs }} {{ existing.installs === 1 ? 'copy' : 'copies' }} installed.
            Changed the agent since? Update the link to publish a new version. People who installed it keep the version they chose.
          </p>
          <ReefFindings v-if="existing.scan.verdict === 'review'" :scan="existing.scan" mode="review" />
        </div>

        <div v-else class="grid sm:grid-cols-2 gap-5">
          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-2">What is shared</p>
            <ul class="space-y-1.5">
              <li v-for="t in SHARED" :key="t" class="flex items-start gap-2 text-sm text-default"><UIcon name="i-lucide-check" class="size-4 mt-0.5 text-success shrink-0" />{{ t }}</li>
            </ul>
          </div>
          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-2">Never shared</p>
            <ul class="space-y-1.5">
              <li v-for="t in NEVER" :key="t" class="flex items-start gap-2 text-sm text-default"><UIcon name="i-lucide-lock" class="size-4 mt-0.5 text-muted shrink-0" />{{ t }}</li>
            </ul>
          </div>
        </div>

        <ReefFindings v-if="blocked" :scan="blocked" mode="blocked" />
        <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />

        <p v-if="!existing" class="text-xs text-muted">Before the link is made, the text is checked for keys, card numbers, hidden characters and look-alike links.</p>
      </div>
    </template>
    <template #footer>
      <div class="flex items-center justify-between gap-2 w-full">
        <UButton v-if="existing" label="Stop sharing" icon="i-lucide-link-2-off" color="error" variant="ghost" :loading="busy" @click="stop" />
        <span v-else />
        <div class="flex items-center gap-2">
          <UButton label="Close" color="neutral" variant="ghost" @click="open = false" />
          <UButton
            :label="existing ? 'Update the link' : 'Create link'"
            :icon="existing ? 'i-lucide-refresh-cw' : 'i-lucide-link'"
            color="neutral"
            :loading="busy"
            :disabled="!mineLoaded"
            @click="publish"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
