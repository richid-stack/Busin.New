<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
// Shows an image OpenLobs saved. The file route needs the person's sign-in token, which a plain <img> cannot send,
// so the picture is fetched like any other request and shown from memory.
defineOptions({ inheritAttrs: false })
const props = defineProps<{ fileId: string, alt?: string }>()

const url = ref('')
const failed = ref(false)
let objectUrl = ''
let latest = 0 // each load gets a number; a load that is no longer the latest is thrown away

watch(() => props.fileId, async (id) => {
  const mine = ++latest
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  url.value = ''
  failed.value = false
  if (!id) return
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error('missing')
    const blob = await res.blob()
    if (mine !== latest) return
    objectUrl = URL.createObjectURL(blob)
    url.value = objectUrl
  } catch {
    if (mine === latest) failed.value = true
  }
}, { immediate: true })

onBeforeUnmount(() => { latest++; if (objectUrl) URL.revokeObjectURL(objectUrl) })
</script>

<template>
  <img v-if="url" v-bind="$attrs" :src="url" :alt="alt">
  <p v-else-if="failed" class="text-sm text-muted">
    The image could not be loaded. It may have expired.
  </p>
  <div v-else class="h-24 w-48 animate-pulse rounded-lg border border-default bg-elevated" />
</template>
