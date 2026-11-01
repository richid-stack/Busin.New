<script setup lang="ts">
import { computed } from 'vue'
import { useHead } from '@unhead/vue'
import { useColorMode } from '@vueuse/core'
import PendingScreen from './components/state/PendingScreen.vue'
import { useOnlineNotice } from './composables/useOnlineNotice'

useOnlineNotice()
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
      <Suspense v-if="Component">
        <component :is="Component" />
        <template #fallback>
          <PendingScreen fill="screen" />
        </template>
      </Suspense>
    </RouterView>
  </UApp>
</template>
