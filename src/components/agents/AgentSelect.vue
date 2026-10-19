<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAgents } from '../../composables/useAgents'

/** Chooses which saved agent a new chat starts with. Shows nothing until the user has made one. */
const model = defineModel<string | null>({ default: null })
const { agents, loaded, fetchAgents } = useAgents()
onMounted(() => { if (!loaded.value) fetchAgents() })

const NONE = '__none__'
const items = computed(() => [
  { label: 'Standard assistant', value: NONE, icon: 'i-lucide-sparkles' },
  ...agents.value.map(a => ({ label: a.name, value: a.id, icon: 'i-lucide-bot' }))
])
const value = computed({
  get: () => model.value ?? NONE,
  set: (v: string) => { model.value = v === NONE ? null : v }
})
</script>

<template>
  <USelectMenu
    v-if="agents.length"
    v-model="value"
    :items="items"
    value-key="value"
    size="sm"
    color="neutral"
    variant="ghost"
    :search-input="false"
    :icon="model ? 'i-lucide-bot' : 'i-lucide-sparkles'"
    aria-label="Choose an agent"
    class="data-[state=open]:bg-elevated"
  />
</template>
