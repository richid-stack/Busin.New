<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useAgents } from '../../../composables/useAgents'
import { useFirebaseAuth } from '../../../composables/useFirebaseAuth'
import type { AgentInput } from '../../../types/agents'

const props = defineProps<{ invocation: any }>()

const { agents, options, loaded, fetchAgents, fetchOptions, createAgent } = useAgents()
const { openAuthModal, isAuthenticated } = useFirebaseAuth()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output)
const draft = computed<AgentInput | null>(() => (output.value?.status === 'proposed' ? output.value.draft : null))

onMounted(() => {
  if (!loaded.value) fetchAgents()
  fetchOptions()
})

// A reload forgets the click, so "already saved" is judged by what the person's agents really contain.
const savedAgent = computed(() => (draft.value ? agents.value.find(a => a.name === draft.value!.name && a.instructions === draft.value!.instructions) : undefined))

const saving = ref(false)
const error = ref<string | null>(null)
const showInstructions = ref(false)

const groupLabel = (id: string) => options.value?.toolGroups.find(g => g.id === id)?.label ?? id

async function save() {
  if (!draft.value || saving.value) return
  if (!isAuthenticated.value) return openAuthModal()
  saving.value = true
  error.value = null
  try {
    await createAgent(draft.value)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not save the agent. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UChatTool
    :text="streaming ? 'Drafting an agent...' : draft ? (savedAgent ? 'Agent saved' : 'Agent draft ready') : 'Could not draft the agent'"
    :suffix="draft?.name || invocation.input?.name"
    :streaming="streaming"
    icon="i-lucide-bot"
    default-open
  >
    <div v-if="draft" class="rounded-2xl border border-default bg-default p-4 flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default shrink-0">
          <UIcon name="i-lucide-bot" class="size-5 text-primary" />
        </div>
        <div class="min-w-0">
          <h4 class="text-sm font-semibold text-highlighted">{{ draft.name }}</h4>
          <p v-if="draft.description" class="text-xs text-muted leading-snug">{{ draft.description }}</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UBadge v-for="id in draft.tools" :key="id" :label="groupLabel(id)" color="neutral" variant="subtle" size="sm" class="max-w-full truncate" />
        <UBadge v-if="!draft.tools.length" label="No tools" color="neutral" variant="subtle" size="sm" />
      </div>

      <div>
        <button
          type="button"
          class="text-xs text-dimmed hover:text-default inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-primary rounded"
          :aria-expanded="showInstructions"
          @click="showInstructions = !showInstructions"
        >
          <UIcon :name="showInstructions ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
          Read its instructions
        </button>
        <p v-if="showInstructions" class="mt-2 text-xs text-muted leading-relaxed whitespace-pre-line border-l border-default pl-3">{{ draft.instructions }}</p>
      </div>

      <p v-if="output.dropped?.length" class="text-xs text-muted">
        Left out for safety: tools that act in your accounts. You can switch those on yourself after saving.
      </p>
      <p v-if="error" class="text-xs text-error" role="alert">{{ error }}</p>

      <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-default">
        <template v-if="savedAgent">
          <UButton :to="{ path: '/', query: { agent: savedAgent.id } }" label="Chat with it" icon="i-lucide-message-circle" size="sm" color="neutral" />
          <UButton to="/agents" label="Edit in Agents" icon="i-lucide-pencil" size="sm" color="neutral" variant="subtle" />
        </template>
        <UButton v-else label="Save agent" icon="i-lucide-check" size="sm" color="neutral" :loading="saving" @click="save" />
      </div>
    </div>

    <div v-else-if="output" class="p-3 border border-error/20 bg-error/5 rounded-md text-error text-xs">{{ output.error }}</div>
  </UChatTool>
</template>
