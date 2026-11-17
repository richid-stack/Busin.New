<script setup lang="ts">
// A plain "are you sure?" for actions that cannot be undone. The page that opens it does the work when it closes with true.
withDefaults(defineProps<{ title: string, description: string, confirmLabel: string, icon?: string }>(), { icon: 'i-lucide-trash-2' })
const emit = defineEmits<{ close: [boolean] }>()
</script>

<template>
  <UModal :title="title" :description="description" :close="false" :ui="{ footer: 'flex-row-reverse justify-start' }">
    <template #footer>
      <UButton color="error" :label="confirmLabel" :icon="icon" @click="emit('close', true)" />
      <UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close', false)" />
    </template>
  </UModal>
</template>
