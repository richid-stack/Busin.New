<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpPreset } from '../../../shared/mcpCatalog'
import type { McpNewServer } from '../../types/mcp'

const props = defineProps<{ open: boolean, saving: boolean, error: string | null, preset?: McpPreset | null }>()
const emit = defineEmits<{ 'update:open': [boolean], 'save': [McpNewServer] }>()

const form = ref({ name: '', url: '', headerName: 'Authorization', token: '' })
const showAdvanced = ref(false)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    const p = props.preset
    form.value = p ? { name: p.name, url: p.url, headerName: p.headerName, token: '' } : { name: '', url: '', headerName: 'Authorization', token: '' }
    showAdvanced.value = false
  }
})

const open = computed({ get: () => props.open, set: v => emit('update:open', v) })
const needsKey = computed(() => props.preset?.auth === 'key')
const valid = computed(() => form.value.name.trim().length > 0 && /^https:\/\/\S+$/i.test(form.value.url.trim()) && (!needsKey.value || form.value.token.trim().length > 0))

function submit() {
  if (!valid.value || props.saving) return
  emit('save', {
    name: form.value.name.trim(),
    url: form.value.url.trim(),
    headerName: form.value.headerName.trim() || 'Authorization',
    token: form.value.token.trim()
  })
}
</script>

<template>
  <UModal v-model:open="open" :title="preset ? `Add ${preset.name}` : 'Add an MCP server'" description="Connect a tool server by its web address. Nothing is used until you approve its tools.">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div v-if="preset" class="text-sm text-muted space-y-2">
          <p>{{ preset.summary }}</p>
          <p v-if="preset.keyHelp">
            {{ preset.keyHelp }}
            <a v-if="preset.keyUrl" :href="preset.keyUrl" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2">Open the page</a>
          </p>
          <p v-if="preset.caution" class="text-warning">{{ preset.caution }}</p>
        </div>
        <UFormField label="Name" description="How you will recognise it, for example “Linear”.">
          <UInput v-model="form.name" placeholder="Linear" maxlength="40" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField label="Server address" description="Must be a public https address.">
          <UInput v-model="form.url" placeholder="https://mcp.example.com/mcp" class="w-full" autocomplete="off" inputmode="url" />
        </UFormField>
        <UFormField :label="needsKey ? 'Key' : 'Access token'" :description="needsKey ? 'Paste the key here. It is stored encrypted and is never shown again.' : 'If the server needs one. It is stored encrypted and is never shown again.'">
          <UInput v-model="form.token" type="password" :placeholder="needsKey ? 'Required' : 'Optional'" class="w-full" autocomplete="off" />
        </UFormField>
        <div>
          <button type="button" class="text-xs text-dimmed hover:text-default inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-primary rounded" :aria-expanded="showAdvanced" @click="showAdvanced = !showAdvanced">
            <UIcon :name="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
            Advanced
          </button>
          <UFormField v-if="showAdvanced" label="Token header" description="Most servers use Authorization. Change it only if the server tells you to." class="mt-3">
            <UInput v-model="form.headerName" class="w-full" autocomplete="off" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Add server" icon="i-lucide-plus" color="neutral" :loading="saving" :disabled="!valid" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
