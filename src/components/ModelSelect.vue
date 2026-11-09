<script setup lang="ts">
import { useModels } from '../composables/useModels'

const { model, items, selected } = useModels()
</script>

<template>
  <USelectMenu
    v-model="model"
    :items="items"
    size="sm"
    :icon="selected?.icon"
    color="neutral"
    variant="ghost"
    value-key="value"
    class="data-[state=open]:bg-elevated"
    :ui="{
      trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
    }"
  >
    <template #content-bottom>
      <RouterLink
        to="/models"
        class="flex items-center gap-2 border-t border-default px-3 py-2 text-xs text-muted hover:text-default"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-3.5"
        />
        Use your own key
      </RouterLink>
    </template>
  </USelectMenu>
</template>
