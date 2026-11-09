<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ReefApiError, useReef } from '../../../composables/useReef'
import type { PostView } from '../../../types/reef'
import ReefShell from '../../../components/reef/ReefShell.vue'
import Composer from '../../../components/reef/Composer.vue'
import PostItem from '../../../components/reef/PostItem.vue'
import ReefSkeleton from '../../../components/reef/ReefSkeleton.vue'
import ReefState from '../../../components/reef/ReefState.vue'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const router = useRouter()
const api = useReef()
const toast = useToast()

const id = computed(() => String(route.params.id))
const post = ref<PostView | null>(null)
const replies = ref<PostView[]>([])
const status = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const failure = ref('')
useHead({ title: computed(() => (post.value ? `${post.value.title || post.value.author.name} · The Reef` : 'Post · The Reef')) })

async function load() {
  status.value = 'loading'
  try {
    const out = await api.getPost(id.value)
    post.value = out.post
    replies.value = out.replies
    status.value = 'ready'
  } catch (err: any) {
    if (err instanceof ReefApiError && err.notFound) status.value = 'missing'
    else { status.value = 'error'; failure.value = err?.message || 'Could not load this post.' }
  }
}
watch(id, load, { immediate: true })

const isQuestion = computed(() => post.value?.type === 'question')
const send = (text: string) => api.reply(id.value, text)
const added = (reply: PostView) => {
  replies.value = [...replies.value, reply]
  if (post.value) post.value = { ...post.value, replies: post.value.replies + 1 }
}
const removed = (rid: string) => {
  replies.value = replies.value.filter(r => r.id !== rid)
  if (post.value) post.value = { ...post.value, replies: Math.max(0, post.value.replies - 1) }
}
const gone = () => { void router.replace('/reef') }

async function accept(answerId: string) {
  try {
    await api.accept(answerId)
    // The accepted answer moves to the top, so the page is read again rather than patched.
    await load()
    toast.add({ title: 'Marked as the answer that worked', icon: 'i-lucide-circle-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not mark it', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
</script>

<template>
  <ReefShell :title="isQuestion ? 'Question' : 'Post'" back>
    <ReefSkeleton v-if="status === 'loading'" :rows="3" />
    <ReefState v-else-if="status === 'missing'" icon="i-lucide-message-circle-off" title="This post is gone" text="It was deleted, or it never existed.">
      <UButton label="Back to The Reef" to="/reef" color="neutral" />
    </ReefState>
    <ReefState v-else-if="status === 'error'" tone="error" icon="i-lucide-cloud-off" title="Could not load this post" :text="failure"><UButton label="Try again" color="neutral" variant="outline" @click="load" /></ReefState>

    <template v-else-if="post">
      <PostItem :post="post" focus @deleted="gone" />
      <Composer reply :send="send" :placeholder="isQuestion ? 'Write an answer' : 'Write your reply'" :max="500" @posted="added" />
      <h2 v-if="replies.length" class="px-4 py-3 text-sm font-semibold text-highlighted border-b border-default">{{ replies.length }} {{ isQuestion ? (replies.length === 1 ? 'answer' : 'answers') : (replies.length === 1 ? 'reply' : 'replies') }}</h2>
      <PostItem v-for="r in replies" :key="r.id" :post="r" :can-accept="isQuestion && post.mine" @deleted="removed" @accept="accept" />
      <p v-if="!replies.length" class="px-6 py-10 text-center text-sm text-muted">{{ isQuestion ? 'No answers yet. If you know this one, help them out.' : 'No replies yet.' }}</p>
    </template>
  </ReefShell>
</template>
