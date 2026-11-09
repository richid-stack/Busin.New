<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useModelProviders } from '../../composables/useModelProviders'
import { MODELS } from '../../../shared/utils/models'
import { AGENT_PRESETS } from '../../utils/agentPresets'
import type { AgentInput, AgentOptions, AgentProfile } from '../../types/agents'

const props = defineProps<{
  agent: AgentProfile | null
  options: AgentOptions | null
  saving: boolean
  error: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ save: [input: AgentInput] }>()

const blank = (): AgentInput => ({ name: '', description: '', instructions: '', model: null, tools: ['web', 'read_files', 'create_files', 'utilities'], skills: [], maxSteps: 8 })
const form = ref<AgentInput>(blank())
const preset = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  preset.value = null
  form.value = props.agent
    ? { name: props.agent.name, description: props.agent.description, instructions: props.agent.instructions, model: props.agent.model, tools: [...props.agent.tools], skills: [...props.agent.skills], maxSteps: props.agent.maxSteps }
    : { ...blank(), skills: (props.options?.skills ?? []).map(s => s.name) }
})

function usePreset(id: string) {
  const chosen = AGENT_PRESETS.find(p => p.id === id)
  if (!chosen) return
  preset.value = id
  const known = new Set((props.options?.skills ?? []).map(s => s.name))
  form.value = { ...chosen.agent, tools: [...chosen.agent.tools], skills: chosen.agent.skills.filter(s => known.has(s)) }
}

function toggle(list: 'tools' | 'skills', value: string, on: boolean) {
  const current = new Set(form.value[list])
  if (on) current.add(value)
  else current.delete(value)
  form.value[list] = [...current]
}

const { myModels, myLoaded, fetchMyModels } = useModelProviders()
onMounted(() => { if (!myLoaded.value) void fetchMyModels() })
const MODEL_ITEMS = computed(() => [{ label: 'Use the model I pick in the chat', value: '__chat__' }, ...MODELS.map(m => ({ label: m.label, value: m.value })), ...myModels.value.map(m => ({ label: `${m.label} (${m.provider})`, value: m.value }))])
const modelValue = computed({
  get: () => form.value.model ?? '__chat__',
  set: (v: string) => { form.value.model = v === '__chat__' ? null : v }
})

const limits = computed(() => props.options?.limits)
const remaining = computed(() => (limits.value?.maxInstructions ?? 4000) - form.value.instructions.length)
const valid = computed(() => form.value.name.trim() && form.value.instructions.trim() && remaining.value >= 0)
const sensitiveOn = computed(() => (props.options?.toolGroups ?? []).filter(g => g.sensitive && form.value.tools.includes(g.id)))

function save() {
  if (!valid.value || props.saving) return
  emit('save', { ...form.value, name: form.value.name.trim(), description: form.value.description.trim(), instructions: form.value.instructions.trim() })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="agent ? `Edit ${agent.name}` : 'New agent'"
    description="An agent is a saved set of instructions, tools and skills you can start a chat with."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div v-if="!options" class="py-10 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else class="space-y-6">
        <div v-if="!agent">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-2">Start from</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              v-for="p in AGENT_PRESETS"
              :key="p.id"
              type="button"
              class="flex items-start gap-3 text-left rounded-xl border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              :class="preset === p.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
              :aria-pressed="preset === p.id"
              @click="usePreset(p.id)"
            >
              <UIcon :name="p.icon" class="size-4 mt-0.5 text-primary shrink-0" />
              <span class="min-w-0">
                <span class="block text-sm font-medium text-highlighted">{{ p.label }}</span>
                <span class="block text-xs text-muted">{{ p.detail }}</span>
              </span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="Name" size="sm" required>
            <UInput v-model="form.name" class="w-full" maxlength="60" placeholder="e.g. Research assistant" />
          </UFormField>
          <UFormField label="Short description" size="sm">
            <UInput v-model="form.description" class="w-full" maxlength="200" placeholder="What it is for" />
          </UFormField>
        </div>

        <UFormField label="Instructions" size="sm" required :help="`${remaining} characters left`">
          <UTextarea
            v-model="form.instructions"
            class="w-full"
            :rows="8"
            autoresize
            :maxrows="14"
            placeholder="Tell it how to work: what to do, how to answer, and what it must never do."
          />
        </UFormField>

        <UFormField label="Model" size="sm" help="An agent can pin one model, or follow whatever you pick in the chat.">
          <USelect v-model="modelValue" :items="MODEL_ITEMS" class="w-full" />
        </UFormField>

        <div>
          <p class="text-sm font-medium text-highlighted mb-0.5">What it can do</p>
          <p class="text-xs text-muted mb-3">It only gets the tools you switch on. Anything off is not available to it, whatever you ask.</p>
          <ul class="divide-y divide-default rounded-xl border border-default">
            <li v-for="group in options.toolGroups" :key="group.id" class="flex items-start justify-between gap-4 p-3">
              <div class="min-w-0">
                <p class="text-sm text-highlighted flex items-center gap-2">
                  {{ group.label }}
                  <UBadge v-if="group.sensitive" label="Acts in your accounts" color="warning" variant="subtle" size="sm" />
                </p>
                <p class="text-xs text-muted">{{ group.detail }}</p>
              </div>
              <USwitch
                :model-value="form.tools.includes(group.id)"
                :aria-label="group.label"
                @update:model-value="toggle('tools', group.id, Boolean($event))"
              />
            </li>
          </ul>
          <UAlert
            v-if="sensitiveOn.length"
            class="mt-3"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="This agent can act on your behalf"
            description="It can send and change things in your connected apps. Say in its instructions when it must ask you first."
          />
        </div>

        <div v-if="options.skills.length">
          <div class="flex items-center justify-between mb-0.5">
            <p class="text-sm font-medium text-highlighted">Skills</p>
            <div class="flex gap-1">
              <UButton label="All" size="xs" color="neutral" variant="ghost" @click="form.skills = options.skills.map(s => s.name)" />
              <UButton label="None" size="xs" color="neutral" variant="ghost" @click="form.skills = []" />
            </div>
          </div>
          <p class="text-xs text-muted mb-3">Expert instructions it can load when a request matches.</p>
          <ul class="divide-y divide-default rounded-xl border border-default">
            <li v-for="skill in options.skills" :key="skill.name" class="flex items-start justify-between gap-4 p-3">
              <div class="min-w-0">
                <p class="text-sm text-highlighted">{{ skill.name }}</p>
                <p class="text-xs text-muted line-clamp-2">{{ skill.description }}</p>
              </div>
              <USwitch
                :model-value="form.skills.includes(skill.name)"
                :aria-label="skill.name"
                @update:model-value="toggle('skills', skill.name, Boolean($event))"
              />
            </li>
          </ul>
        </div>

        <UFormField
          label="Most steps per reply"
          size="sm"
          :help="`Each tool use is a step. Lower is cheaper and safer; ${form.maxSteps} now.`"
        >
          <USlider v-model="form.maxSteps" :min="limits?.minSteps ?? 1" :max="limits?.maxSteps ?? 15" :step="1" />
        </UFormField>

        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
      </div>
    </template>
    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="agent ? 'Save changes' : 'Create agent'" color="neutral" :loading="saving" :disabled="!valid || !options" @click="save" />
      </div>
    </template>
  </UModal>
</template>
