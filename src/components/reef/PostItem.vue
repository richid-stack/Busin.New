<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClipboard } from '@vueuse/core'
import { ReefApiError, postPath, postUrl, useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { fmt, shortAgo } from '../../utils/reefTime'
import type { PostView } from '../../types/reef'
import ReefAvatar from './ReefAvatar.vue'
import ReefName from './ReefName.vue'
import ProjectEmbed from './ProjectEmbed.vue'
import ReportDialog from './ReportDialog.vue'

const ModalConfirm = defineAsyncComponent(() => import('../ModalConfirm.vue'))

const props = withDefaults(defineProps<{
  post: PostView
  /** The post a page is about: bigger, and not a link to itself. */
  focus?: boolean
  /** The viewer asked this question and may mark this answer as the one that worked. */
  canAccept?: boolean
}>(), { focus: false, canAccept: false })
const emit = defineEmits<{ deleted: [id: string], accept: [id: string] }>()

const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const api = useReef()
const { copy } = useClipboard()
const { requireProfile } = useReefMe()

const liked = ref(props.post.liked)
const likes = ref(props.post.likes)
watch(() => props.post, (p) => { liked.value = p.liked; likes.value = p.likes })

let liking = false
async function toggleLike() {
  if (liking) return
  if (!requireProfile(toggleLike)) return
  liking = true
  const was = liked.value
  liked.value = !was
  likes.value += was ? -1 : 1
  try {
    const out = was ? await api.unlike(props.post.id) : await api.like(props.post.id)
    likes.value = out.likes
  } catch (err: any) {
    liked.value = was
    likes.value += was ? 1 : -1
    toast.add({ title: 'Could not do that', description: err instanceof ReefApiError ? err.message : undefined, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    liking = false
  }
}

async function share() {
  await copy(postUrl(props.post.id))
  toast.add({ title: 'Link copied', icon: 'i-lucide-link', color: 'neutral' })
}

const deleteModal = overlay.create(ModalConfirm)
async function remove() {
  const ok = await deleteModal.open({ title: 'Delete this?', description: props.post.replies ? 'The replies under it go too. This cannot be undone.' : 'This cannot be undone.', color: 'error' }).result
  if (!ok) return
  try {
    await api.deletePost(props.post.id)
    emit('deleted', props.post.id)
    toast.add({ title: 'Deleted', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not delete', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const reporting = ref(false)
const menu = computed(() => [[
  { label: 'Copy link', icon: 'i-lucide-link', onSelect: share },
  ...(props.post.mine
    ? [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }]
    : [{ label: 'Report', icon: 'i-lucide-flag', onSelect: () => { if (requireProfile(() => { reporting.value = true })) reporting.value = true } }])
]])

const isQuestion = computed(() => props.post.type === 'question')
const open = () => { if (!props.focus) void router.push(postPath(props.post.id)) }
const onArticle = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('a,button,[role=menuitem]')) return
  open()
}
</script>

<template>
  <article
    class="flex gap-3 px-4 border-b border-default transition-colors"
    :class="[focus ? 'py-5' : 'py-3.5 hover:bg-elevated/30 cursor-pointer', post.isAccepted ? 'bg-success/5' : '']"
    @click="onArticle"
  >
    <ReefAvatar :name="post.author.name" :size="focus ? 46 : 42" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5 text-sm min-w-0">
        <ReefName :person="post.author" />
        <span class="text-dimmed shrink-0">· {{ shortAgo(post.createdAt) }}</span>
        <UDropdownMenu :items="menu" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" class="ml-auto -mr-1 text-muted" aria-label="More" @click.stop />
        </UDropdownMenu>
      </div>

      <p v-if="post.isAccepted" class="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-success"><UIcon name="i-lucide-circle-check" class="size-3.5" />The answer that worked</p>

      <h2 v-if="isQuestion" class="mt-1 font-semibold text-highlighted" :class="focus ? 'text-xl leading-snug' : 'text-[16px] leading-snug'">{{ post.title }}</h2>
      <p v-if="post.text" class="text-default leading-relaxed whitespace-pre-wrap break-words" :class="[focus ? 'text-[16px] mt-2' : 'text-[15px] mt-1', isQuestion && !focus ? 'line-clamp-3 text-muted' : '']">{{ post.text }}</p>

      <div v-if="isQuestion" class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1" :class="post.accepted ? 'bg-success/10 text-success' : 'bg-elevated text-muted'">
          <UIcon :name="post.accepted ? 'i-lucide-circle-check' : 'i-lucide-circle-help'" class="size-3.5" />
          {{ post.accepted ? 'Solved' : 'Open question' }} · {{ post.replies }} {{ post.replies === 1 ? 'answer' : 'answers' }}
        </span>
        <RouterLink v-for="t in post.tags" :key="t" :to="`/reef/projects?tag=${t}`" class="text-xs rounded-md bg-elevated px-2 py-1 text-muted hover:text-highlighted" @click.stop>{{ t }}</RouterLink>
      </div>

      <div v-if="post.project" class="mt-3"><ProjectEmbed :project="post.project" /></div>
      <p v-else-if="post.hasProject" class="mt-3 rounded-2xl border border-dashed border-default px-3.5 py-3 text-sm text-muted">This project is no longer available.</p>

      <div class="flex items-center justify-between max-w-md mt-2 -ml-2 text-muted">
        <button type="button" class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors hover:text-sky-500 hover:bg-sky-500/10 active:scale-95" :aria-label="`${isQuestion ? 'Answer' : 'Reply'}, ${post.replies} so far`" @click.stop="open">
          <UIcon name="i-lucide-message-circle" class="size-4" />{{ fmt(post.replies) }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors hover:text-rose-500 hover:bg-rose-500/10 active:scale-95"
          :class="liked ? 'text-rose-500' : ''"
          :aria-pressed="liked"
          :aria-label="`${liked ? 'Unlike' : 'Like'}, ${likes} so far`"
          @click.stop="toggleLike"
        >
          <UIcon name="i-lucide-heart" class="size-4 transition-transform" :class="liked ? 'scale-110 [&>*]:fill-current' : ''" />{{ fmt(likes) }}
        </button>
        <UButton v-if="canAccept && post.type === 'answer' && !post.isAccepted" label="This worked" icon="i-lucide-circle-check" size="xs" color="success" variant="soft" @click.stop="emit('accept', post.id)" />
        <button type="button" class="inline-flex items-center rounded-full px-2 py-1 transition-colors hover:text-sky-500 hover:bg-sky-500/10 active:scale-95" aria-label="Copy link" @click.stop="share"><UIcon name="i-lucide-share" class="size-4" /></button>
      </div>
    </div>

    <ReportDialog v-model:open="reporting" :title="isQuestion ? 'Report this question' : 'Report this post'" :send="(reason: string, note: string) => api.reportPost(post.id, reason, note)" />
  </article>
</template>
