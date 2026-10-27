<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { useReefSide } from '../../composables/useReefSide'
import { useReefUi } from '../../composables/useReefUi'
import { useUserSession } from '../../composables/useUserSession'
import { fmt } from '../../utils/reefTime'
import { KINDS } from '../../utils/reefKinds'
import ModalAuth from '../ModalAuth.vue'
import AskDialog from './AskDialog.vue'
import ProfileSetupDialog from './ProfileSetupDialog.vue'
import PublishDialog from './PublishDialog.vue'
import ReefAvatar from './ReefAvatar.vue'
import ReefName from './ReefName.vue'
import ReefRail from './ReefRail.vue'
import ReefSearch from './ReefSearch.vue'

withDefaults(defineProps<{
  title?: string
  /** A wide centre column with no right rail, for pages like a project. */
  wide?: boolean
  back?: boolean
}>(), { title: '', wide: false, back: false })

const route = useRoute()
const toast = useToast()
const api = useReef()
const { profile, signedIn, requireProfile, reload } = useReefMe()
const { side, load: loadSide, drop } = useReefSide()
const { fetchSession } = useUserSession()
const { publishOpen, publishAgent, publishName, askOpen, openPublish } = useReefUi()

const drawer = ref(false)
watch(() => route.fullPath, () => { drawer.value = false })
// The Reef pages have no app layout, so they ask who is signed in and carry the sign-in dialog themselves.
onMounted(() => { void fetchSession(); void loadSide() })

const following = ref(new Set<string>())
async function follow(handle: string) {
  if (!requireProfile(() => follow(handle))) return
  try {
    await api.follow(handle)
    following.value = new Set([...following.value, handle])
    setTimeout(() => drop(handle), 900)
    void reload()
  } catch (err: any) {
    toast.add({ title: 'Could not follow', description: err?.message, icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const compose = () => { if (requireProfile(() => openPublish())) openPublish() }
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto flex max-w-[1320px] justify-center">
      <!-- Left column (tablet and desktop) -->
      <header class="hidden md:block sticky top-0 h-screen w-[76px] xl:w-[260px] shrink-0">
        <ReefRail />
      </header>

      <!-- Centre -->
      <main class="min-h-screen w-full border-x border-default pb-24 md:pb-0" :class="wide ? 'max-w-[1040px]' : 'max-w-[640px]'">
        <div v-if="title || $slots.header || back" class="sticky top-0 z-20 bg-default/80 backdrop-blur-md border-b border-default">
          <div class="flex items-center gap-3 px-4 h-14">
            <RouterLink v-if="back" to="/reef" class="rounded-full p-2 -ml-2 hover:bg-elevated transition-colors" aria-label="Back to The Reef" @click.prevent="$router.back()"><UIcon name="i-lucide-arrow-left" class="size-5" /></RouterLink>
            <button v-else type="button" class="md:hidden -ml-1 rounded-full active:scale-95 transition-transform" aria-label="Open the menu" @click="drawer = true">
              <ReefAvatar v-if="profile" :name="profile.name" :size="32" />
              <span v-else class="size-8 flex items-center justify-center rounded-full bg-elevated"><UIcon name="i-lucide-menu" class="size-4" /></span>
            </button>
            <h1 class="text-lg font-semibold text-highlighted truncate">{{ title }}</h1>
            <div class="ml-auto flex items-center gap-2"><slot name="action" /></div>
          </div>
          <slot name="header" />
        </div>
        <slot />
      </main>

      <!-- Right column (desktop) -->
      <aside v-if="!wide" class="hidden lg:block w-[340px] shrink-0 px-6 py-3">
        <div class="sticky top-3 space-y-4">
          <ReefSearch />

          <section v-if="side?.trending.length" class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="trend">
            <h2 id="trend" class="px-4 pb-1 text-lg font-bold text-highlighted">Trending projects</h2>
            <RouterLink v-for="p in side.trending" :key="`${p.owner}/${p.name}`" :to="`/reef/${p.owner}/${p.name}`" class="block px-4 py-2.5 hover:bg-elevated transition-colors">
              <p class="text-xs text-muted">{{ KINDS[p.kind].label }} · {{ fmt(p.stars) }} {{ p.stars === 1 ? 'star' : 'stars' }}</p>
              <p class="text-[15px] font-semibold text-highlighted truncate">{{ p.owner }}/{{ p.name }}</p>
            </RouterLink>
          </section>

          <section v-if="side?.people.length" class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="follow">
            <h2 id="follow" class="px-4 pb-1 text-lg font-bold text-highlighted">Who to follow</h2>
            <div v-for="p in side.people" :key="p.handle" class="flex items-center gap-3 px-4 py-2.5">
              <ReefAvatar :name="p.name" :size="40" />
              <div class="min-w-0 flex-1 text-sm leading-tight">
                <ReefName :person="p" :handle="false" />
                <p class="text-muted truncate">@{{ p.handle }}</p>
              </div>
              <UButton :label="following.has(p.handle) ? 'Following' : 'Follow'" size="sm" color="neutral" :variant="following.has(p.handle) ? 'outline' : 'solid'" class="rounded-full" @click="follow(p.handle)" />
            </div>
          </section>

          <section v-if="side?.open.length" class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="oq">
            <h2 id="oq" class="px-4 pb-1 text-lg font-bold text-highlighted">Open questions</h2>
            <RouterLink v-for="q in side.open" :key="q.id" :to="`/reef/post/${q.id}`" class="block px-4 py-2.5 hover:bg-elevated transition-colors">
              <p class="text-[15px] text-highlighted line-clamp-2">{{ q.title }}</p>
              <p class="text-xs text-muted mt-0.5">{{ q.replies }} {{ q.replies === 1 ? 'answer' : 'answers' }}</p>
            </RouterLink>
          </section>

          <div v-if="!signedIn" class="rounded-2xl border border-default p-4">
            <p class="font-semibold text-highlighted">New to The Reef?</p>
            <p class="text-sm text-muted mt-1">Anyone can read. Sign in to post, star, follow and share what you build.</p>
          </div>
          <p class="px-2 text-xs text-dimmed">Open source · Made in Ghana</p>
        </div>
      </aside>
    </div>

    <!-- Phone: the same left column, slid in from the left -->
    <USlideover v-model:open="drawer" side="left" title="The Reef" description="Menu" :ui="{ content: 'max-w-[300px] w-[85vw]', header: 'sr-only', body: 'p-0' }">
      <template #body><div class="h-full"><ReefRail expanded @go="drawer = false" /></div></template>
    </USlideover>
    <button type="button" class="md:hidden fixed right-4 bottom-6 z-30 size-14 rounded-full bg-primary text-inverted shadow-lg flex items-center justify-center active:scale-95 transition-transform" aria-label="Share a project" @click="compose">
      <UIcon name="i-lucide-plus" class="size-6" />
    </button>

    <ModalAuth />
    <ProfileSetupDialog />
    <PublishDialog v-model:open="publishOpen" :agent="publishAgent" :preset-name="publishName" />
    <AskDialog v-model:open="askOpen" />
  </div>
</template>
