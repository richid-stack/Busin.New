<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { useReef } from '../../composables/useReef'
import { useReefList } from '../../composables/useReefList'
import { useReefMe } from '../../composables/useReefMe'
import type { PostView } from '../../types/reef'
import ReefShell from '../../components/reef/ReefShell.vue'
import Composer from '../../components/reef/Composer.vue'
import PostItem from '../../components/reef/PostItem.vue'
import ReefSkeleton from '../../components/reef/ReefSkeleton.vue'
import ReefState from '../../components/reef/ReefState.vue'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'

definePage({ meta: { layout: 'blank' } })
useHead({ title: 'Home · The Reef' })

const api = useReef()
const { signedIn } = useReefMe()
const { openAuthModal } = useFirebaseAuth()

const TABS = [{ id: 'foryou', label: 'For you' }, { id: 'following', label: 'Following' }, { id: 'questions', label: 'Questions' }] as const
const tab = ref<typeof TABS[number]['id']>('foryou')
const feed = useReefList<PostView>(before => api.feed({ tab: tab.value, before }))

onMounted(() => { void feed.load() })
watch(tab, () => { void feed.load() })
// Signing in or out changes what "Following" and the like marks show.
watch(signedIn, () => { void feed.load() })

const added = (post: PostView) => { feed.items.value = [post, ...feed.items.value] }
const gone = (id: string) => { feed.items.value = feed.items.value.filter(p => p.id !== id) }
</script>

<template>
  <ReefShell title="Home">
    <template #header>
      <div class="flex" role="tablist">
        <button v-for="t in TABS" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" class="relative flex-1 py-3.5 text-sm transition-colors hover:bg-elevated/60" :class="tab === t.id ? 'font-semibold text-highlighted' : 'text-muted'" @click="tab = t.id">
          {{ t.label }}
          <span v-if="tab === t.id" class="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-14 rounded-full bg-primary" />
        </button>
      </div>
    </template>

    <Composer @posted="added" />

    <ReefSkeleton v-if="feed.loading.value" />
    <ReefState v-else-if="feed.error.value" tone="error" icon="i-lucide-cloud-off" title="Could not load the feed" :text="feed.error.value">
      <UButton label="Try again" color="neutral" variant="outline" @click="feed.load()" />
    </ReefState>
    <template v-else-if="feed.items.value.length">
      <PostItem v-for="p in feed.items.value" :key="p.id" :post="p" @deleted="gone" />
      <div v-if="feed.next.value" class="p-4 flex justify-center"><UButton label="Show more" color="neutral" variant="outline" :loading="feed.loadingMore.value" @click="feed.more()" /></div>
    </template>
    <ReefState v-else-if="tab === 'following' && !signedIn" icon="i-lucide-users" title="Follow people to fill this tab" text="Sign in, follow the makers you like, and their posts show up here.">
      <UButton label="Sign in" color="neutral" @click="openAuthModal()" />
    </ReefState>
    <ReefState v-else-if="tab === 'following'" icon="i-lucide-users" title="Nothing here yet" text="Follow a few people and their posts show up here. Try Who to follow on the right, or look at Projects." />
    <ReefState v-else-if="tab === 'questions'" icon="i-lucide-circle-help" title="No questions yet" text="Be the first to ask. Someone who has been through it will answer." />
    <ReefState v-else icon="i-lucide-waves" title="The Reef is quiet" text="Nobody has posted yet. Share what you built, or ask what you are stuck on." />
  </ReefShell>
</template>
