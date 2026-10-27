<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ReefApiError, useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { NEED_ICONS } from '../../utils/reefKinds'
import type { ProjectDetail } from '../../types/reef'

const props = defineProps<{ project: ProjectDetail }>()
const emit = defineEmits<{ installed: [] }>()
const open = defineModel<boolean>('open', { default: false })

const router = useRouter()
const toast = useToast()
const api = useReef()
const { requireProfile } = useReefMe()

/** Tools that can change things outside OpenLobs start switched off. The person turns on only what they trust. */
const allow = ref<Record<string, boolean>>({})
const busy = ref(false)
const error = ref<string | null>(null)
watch(open, (o) => { if (o) { allow.value = {}; error.value = null } })

async function add() {
  if (busy.value) return
  if (!requireProfile(() => { open.value = true })) { open.value = false; return }
  busy.value = true
  error.value = null
  try {
    const out = await api.install(props.project.owner, props.project.name, Object.entries(allow.value).filter(([, on]) => on).map(([id]) => id))
    open.value = false
    emit('installed')
    toast.add({
      title: `Added ${out.agent.name} to your agents`,
      description: out.withheld.length ? `Left switched off: ${out.withheld.map(w => w.label).join(', ')}. You can turn them on in the agent.` : undefined,
      icon: 'i-lucide-check',
      color: 'success',
      actions: [{ label: 'Open agents', onClick: () => { void router.push('/agents') } }]
    })
  } catch (err: any) {
    error.value = err instanceof ReefApiError ? err.message : 'Could not add it. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Add ${project.name} to OpenLobs`" description="You get your own copy. Changing it later never changes the original.">
    <template #body>
      <div class="space-y-4">
        <div v-if="project.scan.verdict === 'review'" class="rounded-xl border border-warning/40 bg-warning/5 p-3.5 text-sm"><p class="font-medium text-highlighted">Read the instructions first</p><p class="text-muted mt-0.5">The automatic check found something worth a second look. You can read the instructions under the Needs tab before adding it.</p></div>
        <p v-if="!project.needs.length" class="text-sm text-muted">This agent only talks. It does not use any tools, so nothing needs your permission.</p>
        <ul v-else class="rounded-xl border border-default divide-y divide-default overflow-hidden">
          <li v-for="n in project.needs" :key="n.id" class="flex items-center gap-3 px-3.5 py-3">
            <UIcon :name="NEED_ICONS[n.id] ?? 'i-lucide-puzzle'" class="size-5 shrink-0 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted">{{ n.label }}</p>
              <p class="text-xs text-muted">{{ n.detail }}</p>
            </div>
            <USwitch v-if="n.sensitive" v-model="allow[n.id]" :aria-label="`Allow ${n.label}`" />
            <span v-else class="text-xs text-muted shrink-0">Included</span>
          </li>
        </ul>
        <p v-if="project.needs.some(n => n.sensitive)" class="text-xs text-muted">Tools that can read files, use your apps or change things start switched off. Turn on only the ones you trust. Anything that sends or changes something still asks for your OK each time.</p>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Add to my agents" icon="i-lucide-plus" :loading="busy" @click="add" />
      </div>
    </template>
  </UModal>
</template>
