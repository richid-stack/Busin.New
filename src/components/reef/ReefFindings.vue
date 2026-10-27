<script setup lang="ts">
import type { ReefScan } from '../../types/reef'

defineProps<{ scan: ReefScan, mode: 'blocked' | 'review' }>()

const FIELD: Record<string, string> = { name: 'Name', description: 'Description', instructions: 'Instructions', readme: 'README', note: 'Note', tags: 'Tags', text: 'Text', title: 'Question', bio: 'Bio' }
</script>

<template>
  <UAlert
    :color="mode === 'blocked' ? 'error' : 'warning'"
    variant="subtle"
    :icon="mode === 'blocked' ? 'i-lucide-shield-x' : 'i-lucide-shield-alert'"
    :title="mode === 'blocked' ? 'This cannot be shared yet' : 'Read this carefully before you install it'"
  >
    <template #description>
      <p class="mb-2">{{ mode === 'blocked' ? 'Fix what is listed, then try again.' : 'An automatic check found something worth a second look. It may be fine.' }}</p>
      <ul class="space-y-2">
        <li v-for="(f, i) in scan.findings" :key="i" class="text-sm">
          <span class="font-medium">{{ FIELD[f.field] ?? f.field }}:</span> {{ f.message }}
          <code v-if="f.excerpt" class="block mt-0.5 text-xs opacity-80 break-words whitespace-pre-wrap">{{ f.excerpt }}</code>
        </li>
      </ul>
    </template>
  </UAlert>
</template>
