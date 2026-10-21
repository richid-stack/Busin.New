<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useIntegrations } from '../../composables/useIntegrations'
import { TEMPLATE_APPS, TEMPLATE_CATEGORIES, WORKFLOW_TEMPLATES, templateFlow } from '../../utils/workflowTemplates'
import type { TemplateCategory, WorkflowTemplate } from '../../utils/workflowTemplates'

defineProps<{ creating: boolean }>()
const emit = defineEmits<{ use: [payload: { template: WorkflowTemplate, title: string }] }>()

const { integrations, fetchIntegrations } = useIntegrations()
onMounted(() => { if (!integrations.value.length) fetchIntegrations() })

const isConnected = (provider: string) => integrations.value.some(i => i.provider === provider && i.status === 'connected')

const category = ref<TemplateCategory | 'All'>('All')
const filters = ['All', ...TEMPLATE_CATEGORIES] as const
const visible = computed(() => WORKFLOW_TEMPLATES.filter(t => category.value === 'All' || t.category === category.value))

const open = ref(false)
const selected = ref<WorkflowTemplate | null>(null)
const title = ref('')

function choose(template: WorkflowTemplate) {
  selected.value = template
  title.value = template.title
  open.value = true
}

const missing = computed(() => (selected.value?.apps ?? []).filter(a => !isConnected(a)))

function confirm() {
  if (!selected.value || !title.value.trim()) return
  emit('use', { template: selected.value, title: title.value.trim() })
}

defineExpose({ close: () => { open.value = false } })
</script>

<template>
  <section aria-labelledby="templates-heading">
    <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h2 id="templates-heading" class="text-lg font-semibold tracking-tight text-highlighted">Start from a template</h2>
        <p class="text-sm text-muted mt-0.5">Ready-made workflows you can adjust. Each one is saved as a draft, so nothing runs until you deploy it.</p>
      </div>
    </div>

    <div class="flex flex-wrap gap-1.5 mb-5" role="group" aria-label="Filter templates">
      <UButton
        v-for="name in filters"
        :key="name"
        :label="name"
        size="xs"
        color="neutral"
        :variant="category === name ? 'solid' : 'subtle'"
        :aria-pressed="category === name"
        @click="category = name"
      />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button
        v-for="template in visible"
        :key="template.id"
        type="button"
        class="group text-left rounded-2xl border border-default bg-default p-5 hover:bg-elevated/60 hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-2 focus-visible:outline-primary"
        @click="choose(template)"
      >
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default">
            <UIcon :name="template.icon" class="size-5 text-primary" />
          </div>
          <span class="inline-flex items-center gap-1 text-[11px] text-muted rounded-full border border-default px-2 py-0.5">
            <UIcon name="i-lucide-zap" class="size-3" />
            {{ template.starts }}
          </span>
        </div>
        <h3 class="text-sm font-semibold text-highlighted mb-1">{{ template.title }}</h3>
        <p class="text-xs text-muted leading-relaxed line-clamp-3 min-h-[3rem]">{{ template.description }}</p>
        <div class="flex items-center gap-2 mt-4 min-h-5">
          <template v-if="template.apps.length">
            <span v-for="app in template.apps" :key="app" class="inline-flex items-center gap-1 text-[11px] text-muted">
              <UIcon :name="TEMPLATE_APPS[app]!.icon" class="size-3.5" />
              {{ TEMPLATE_APPS[app]!.name }}
            </span>
          </template>
          <span v-else class="text-[11px] text-dimmed">No apps needed</span>
        </div>
      </button>
    </div>

    <UModal v-model:open="open" :title="selected?.title" :description="selected?.description">
      <template #body>
        <div v-if="selected" class="space-y-5">
          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-2">How it works</p>
            <ol class="space-y-0">
              <li v-for="(step, index) in templateFlow(selected)" :key="index" class="flex items-start gap-3 relative pb-3 last:pb-0">
                <span
                  v-if="index < templateFlow(selected).length - 1"
                  class="absolute left-[13px] top-7 bottom-0 w-px bg-border"
                  aria-hidden="true"
                />
                <span class="size-7 shrink-0 rounded-lg border border-default bg-default flex items-center justify-center">
                  <UIcon :name="step.icon" class="size-3.5 text-muted" />
                </span>
                <span class="min-w-0 pt-0.5">
                  <span class="block text-sm text-highlighted leading-tight">{{ step.title }}</span>
                  <span v-if="step.subtitle" class="block text-xs text-muted">{{ step.subtitle }}</span>
                </span>
              </li>
            </ol>
          </div>

          <div v-if="selected.apps.length">
            <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-2">Apps it uses</p>
            <ul class="space-y-1.5">
              <li v-for="app in selected.apps" :key="app" class="flex items-center justify-between gap-3 text-sm">
                <span class="inline-flex items-center gap-2">
                  <UIcon :name="TEMPLATE_APPS[app]!.icon" class="size-4" />
                  {{ TEMPLATE_APPS[app]!.name }}
                </span>
                <UBadge
                  :label="isConnected(app) ? 'Connected' : 'Not connected'"
                  :color="isConnected(app) ? 'success' : 'warning'"
                  variant="subtle"
                  size="sm"
                />
              </li>
            </ul>
            <p v-if="missing.length" class="text-xs text-muted mt-2">
              You can still add the template now. Connect {{ missing.map(a => TEMPLATE_APPS[a]!.name).join(' and ') }} on the
              <RouterLink to="/integrations" class="underline underline-offset-2 hover:text-highlighted">Integrations page</RouterLink>
              before you deploy it.
            </p>
          </div>

          <UAlert color="neutral" variant="subtle" icon="i-lucide-pencil-line" title="Before you switch it on" :description="selected.setup" />

          <UFormField label="Name" size="sm">
            <UInput v-model="title" size="md" class="w-full" maxlength="120" @keydown.enter.prevent="confirm" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Use this template" icon="i-lucide-plus" color="neutral" :loading="creating" :disabled="!title.trim()" @click="confirm" />
        </div>
      </template>
    </UModal>
  </section>
</template>
