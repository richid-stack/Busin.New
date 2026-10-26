<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { PEOPLE, QUESTIONS } from '../../reef/concept'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefAvatar from '../../components/reef/ReefAvatar.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Questions · The Reef' })

const TABS = ['Newest', 'Unanswered', 'Answered']
const tab = ref('Newest')
const list = computed(() => (tab.value === 'Unanswered' ? QUESTIONS.filter(q => q.answers === 0) : tab.value === 'Answered' ? QUESTIONS.filter(q => q.solved) : QUESTIONS))
</script>

<template>
  <ReefShell title="Questions">
    <template #action><UButton label="Ask a question" icon="i-lucide-plus" color="neutral" size="sm" class="rounded-full" /></template>
    <template #header>
      <div class="flex" role="tablist">
        <button v-for="t in TABS" :key="t" type="button" role="tab" :aria-selected="tab === t" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t">
          {{ t }}<span v-if="tab === t" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-14 rounded-full bg-primary" />
        </button>
      </div>
    </template>

    <article v-for="q in list" :key="q.id" class="flex gap-4 px-4 py-4 border-b border-default hover:bg-elevated/30 transition-colors cursor-pointer">
      <div class="w-14 shrink-0 text-center">
        <div class="rounded-xl border px-1 py-1.5" :class="q.solved ? 'border-success/40 bg-success/10 text-success' : q.answers ? 'border-default text-highlighted' : 'border-default text-dimmed'">
          <p class="text-lg font-semibold leading-none">{{ q.answers }}</p>
          <p class="text-[10px] mt-0.5 flex items-center justify-center gap-0.5"><UIcon v-if="q.solved" name="i-lucide-check" class="size-3" />{{ q.solved ? 'solved' : q.answers === 1 ? 'answer' : 'answers' }}</p>
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-[15px] font-semibold text-highlighted leading-snug">{{ q.title }}</h2>
        <div class="flex flex-wrap items-center gap-1.5 mt-2">
          <UBadge v-for="t in q.tags" :key="t" :label="t" color="neutral" variant="subtle" size="sm" />
          <RouterLink v-if="q.project" :to="`/reef/${q.project}`" class="text-xs text-primary hover:underline">{{ q.project }}</RouterLink>
        </div>
        <p class="flex items-center gap-1.5 text-xs text-muted mt-2.5"><ReefAvatar :name="PEOPLE[q.by]!.name" :size="18" />{{ PEOPLE[q.by]!.name }} asked {{ q.when }}</p>
      </div>
    </article>
  </ReefShell>
</template>
