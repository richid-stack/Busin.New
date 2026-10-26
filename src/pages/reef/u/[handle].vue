<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { PEOPLE, POSTS, PROJECTS, QUESTIONS, fmt } from '../../../reef/concept'
import ReefShell from '../../../components/reef/ReefShell.vue'
import ReefAvatar from '../../../components/reef/ReefAvatar.vue'
import PostItem from '../../../components/reef/PostItem.vue'
import ProjectEmbed from '../../../components/reef/ProjectEmbed.vue'
import { accentGradient } from '../../../utils/accentGradient'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const person = computed(() => PEOPLE[String(route.params.handle)])
useHead({ title: computed(() => `${person.value?.name ?? 'Profile'} · The Reef`) })

const TABS = ['Projects', 'Posts', 'Questions', 'Stars']
const tab = ref('Projects')
const mine = computed(() => PROJECTS.filter(p => p.owner === person.value?.handle))
const posts = computed(() => POSTS.filter(p => p.by === person.value?.handle))
const qs = computed(() => QUESTIONS.filter(q => q.by === person.value?.handle))
const stars = computed(() => PROJECTS.filter(p => p.owner !== person.value?.handle).slice(0, 3))
const totalStars = computed(() => mine.value.reduce((a, p) => a + p.stars, 0))
</script>

<template>
  <ReefShell v-if="person" :title="person.name" back>
    <div class="h-36 sm:h-48" :class="accentGradient(person.name)" />
    <div class="px-4">
      <div class="flex items-start justify-between -mt-12 sm:-mt-16">
        <span class="rounded-full border-4 border-default bg-default"><ReefAvatar :name="person.name" :size="96" /></span>
        <UButton label="Follow" color="neutral" class="rounded-full px-5 mt-14 sm:mt-[4.5rem]" />
      </div>
      <h2 class="mt-3 flex items-center gap-1.5 text-xl font-bold text-highlighted">{{ person.name }}
        <UIcon v-if="person.verified" name="i-lucide-badge-check" class="size-5" :class="person.official ? 'text-primary' : 'text-sky-500'" />
      </h2>
      <p class="text-muted text-sm">@{{ person.handle }}<span v-if="person.official"> · Official</span></p>
      <p class="mt-3 text-[15px] text-default">{{ person.bio }}</p>
      <p class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-muted">
        <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-map-pin" class="size-4" />{{ person.place }}</span>
        <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-calendar" class="size-4" />Joined {{ person.joined }}</span>
      </p>
      <p class="flex gap-5 mt-3 text-sm text-muted">
        <span><b class="text-highlighted">{{ fmt(person.following) }}</b> Following</span>
        <span><b class="text-highlighted">{{ fmt(person.followers) }}</b> Followers</span>
        <span><b class="text-highlighted">{{ fmt(totalStars) }}</b> Stars earned</span>
      </p>
    </div>

    <div class="flex mt-4 border-b border-default" role="tablist">
      <button v-for="t in TABS" :key="t" type="button" role="tab" :aria-selected="tab === t" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t">
        {{ t }}<span v-if="tab === t" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-primary" />
      </button>
    </div>

    <div v-if="tab === 'Projects'" class="p-4">
      <p class="text-xs font-medium uppercase tracking-wide text-dimmed mb-3">Pinned</p>
      <div v-if="mine.length" class="grid sm:grid-cols-2 gap-3"><ProjectEmbed v-for="p in mine" :key="p.name" :project="p" /></div>
      <p v-else class="text-sm text-muted py-10 text-center">No projects yet.</p>
    </div>
    <div v-else-if="tab === 'Posts'"><PostItem v-for="p in posts" :key="p.id" :post="p" /><p v-if="!posts.length" class="text-sm text-muted py-10 text-center">No posts yet.</p></div>
    <div v-else-if="tab === 'Questions'">
      <div v-for="q in qs" :key="q.id" class="px-4 py-4 border-b border-default"><p class="text-[15px] font-semibold text-highlighted">{{ q.title }}</p><p class="text-xs text-muted mt-1">{{ q.answers }} answers · {{ q.when }}</p></div>
      <p v-if="!qs.length" class="text-sm text-muted py-10 text-center">No questions yet.</p>
    </div>
    <div v-else class="p-4 grid sm:grid-cols-2 gap-3"><ProjectEmbed v-for="p in stars" :key="p.name" :project="p" /></div>
  </ReefShell>
  <ReefShell v-else title="Profile" back>
    <div class="py-24 text-center"><p class="text-lg font-semibold text-highlighted">This account does not exist</p><p class="text-sm text-muted mt-1">Try searching for someone else.</p></div>
  </ReefShell>
</template>
