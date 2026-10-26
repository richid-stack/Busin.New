<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { PEOPLE, POSTS } from '../../reef/concept'
import ReefShell from '../../components/reef/ReefShell.vue'
import ReefAvatar from '../../components/reef/ReefAvatar.vue'
import PostItem from '../../components/reef/PostItem.vue'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Home · The Reef' })

const me = PEOPLE.ama!
const TABS = ['For you', 'Following', 'Questions']
const tab = ref('For you')
const posts = computed(() => (tab.value === 'Questions' ? POSTS.filter(p => p.question) : tab.value === 'Following' ? POSTS.filter(p => ['kwesi', 'nanayaa', 'efua'].includes(p.by)) : POSTS))
</script>

<template>
  <ReefShell title="Home">
    <template #header>
      <div class="flex" role="tablist">
        <button v-for="t in TABS" :key="t" type="button" role="tab" :aria-selected="tab === t" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t">
          {{ t }}
          <span v-if="tab === t" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-14 rounded-full bg-primary" />
        </button>
      </div>
    </template>

    <div class="flex gap-3 px-4 py-4 border-b border-default">
      <ReefAvatar :name="me.name" :size="42" />
      <div class="flex-1 min-w-0">
        <textarea class="w-full resize-none bg-transparent text-lg outline-none placeholder:text-dimmed py-1.5" rows="2" placeholder="What did you build, or what are you stuck on?" aria-label="Write a post" />
        <div class="flex items-center justify-between pt-2 border-t border-default">
          <div class="flex gap-1 text-primary">
            <UButton icon="i-lucide-boxes" variant="ghost" size="sm" color="primary" aria-label="Attach a project" />
            <UButton icon="i-lucide-circle-help" variant="ghost" size="sm" color="primary" aria-label="Ask a question" />
          </div>
          <UButton label="Post" color="neutral" class="rounded-full px-5" />
        </div>
      </div>
    </div>

    <PostItem v-for="p in posts" :key="p.id" :post="p" />
    <div class="py-10 text-center text-sm text-muted">You are all caught up.</div>
  </ReefShell>
</template>
