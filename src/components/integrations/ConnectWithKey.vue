<script setup lang="ts">
import { reactive, computed } from 'vue'

const props = defineProps<{
  name: string
  fields: Array<{ id: string, label: string, placeholder?: string, help?: string, secret: boolean }>
  advice?: string
  getKeyUrl?: string
  busy?: boolean
}>()
const emit = defineEmits<{ save: [values: Record<string, string>] }>()

const values = reactive<Record<string, string>>({})
const ready = computed(() => props.fields.length > 0 && props.fields.every(f => (values[f.id] ?? '').trim().length > 0))

function submit() {
  if (!ready.value || props.busy) return
  emit('save', Object.fromEntries(props.fields.map(f => [f.id, (values[f.id] ?? '').trim()])))
}
</script>

<template>
  <form class="rounded-2xl border border-default bg-elevated/40 p-5 space-y-4" autocomplete="off" @submit.prevent="submit">
    <div class="flex items-start gap-3">
      <div class="size-9 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center shrink-0">
        <UIcon name="i-lucide-key-round" class="size-4 text-primary" />
      </div>
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-highlighted">Connect {{ name }} with your key</h3>
        <p class="text-xs text-muted leading-relaxed mt-1">{{ advice }}</p>
      </div>
    </div>

    <UFormField v-for="field in fields" :key="field.id" :label="field.label" :help="field.help">
      <UInput
        v-model="values[field.id]"
        :type="field.secret ? 'password' : 'text'"
        :placeholder="field.placeholder"
        autocomplete="off"
        spellcheck="false"
        class="w-full"
        :disabled="busy"
      />
    </UFormField>

    <div class="flex flex-wrap items-center gap-3">
      <UButton type="submit" label="Save and connect" icon="i-lucide-plug" color="neutral" class="rounded-full" :loading="busy" :disabled="!ready" />
      <a v-if="getKeyUrl" :href="getKeyUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-muted hover:text-default inline-flex items-center gap-1">
        Where do I find my key?
        <UIcon name="i-lucide-external-link" class="size-3" />
      </a>
    </div>
  </form>
</template>
