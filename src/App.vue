<script setup lang="ts">
import { computed } from 'vue'
import { useHead } from '@unhead/vue'
import { useColorMode } from '@vueuse/core'

const colorMode = useColorMode()
const themeColor = computed(() => colorMode.value === 'dark' ? '#09090b' : '#fafafa')

useHead({
  meta: [
    { name: 'theme-color', content: themeColor }
  ]
})
</script>

<template>
  <UApp :toaster="{ position: 'top-right' }">
    <RouterView v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
        <template #fallback>
          <div class="h-screen w-screen flex items-center justify-center bg-(--ui-bg)">
            <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-(--ui-primary)" />
          </div>
        </template>
      </Suspense>
    </RouterView>
  </UApp>
</template>
