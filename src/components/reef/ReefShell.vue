<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { PEOPLE, TRENDING, QUESTIONS, fmt, project as findProject } from '../../reef/concept'
import ReefAvatar from './ReefAvatar.vue'
import ReefName from './ReefName.vue'

withDefaults(defineProps<{
  title?: string
  /** A wide centre column with no right rail, for pages like a project. */
  wide?: boolean
  back?: boolean
}>(), { title: '', wide: false, back: false })

const route = useRoute()
const me = PEOPLE.ama!

const NAV = [
  { label: 'Home', icon: 'i-lucide-house', to: '/reef', match: (p: string) => p === '/reef' },
  { label: 'Projects', icon: 'i-lucide-boxes', to: '/reef/projects', match: (p: string) => p.startsWith('/reef/projects') || /^\/reef\/[^/]+\/[^/]+$/.test(p) && !p.startsWith('/reef/u/') },
  { label: 'Questions', icon: 'i-lucide-circle-help', to: '/reef/questions', match: (p: string) => p.startsWith('/reef/questions') },
  { label: 'Alerts', icon: 'i-lucide-bell', to: '/reef', match: () => false },
  { label: 'Profile', icon: 'i-lucide-user-round', to: `/reef/u/${me.handle}`, match: (p: string) => p.startsWith('/reef/u/') }
]
const active = (n: typeof NAV[number]) => n.match(route.path)

const trending = computed(() => TRENDING.map((t) => { const [o, n] = t.split('/'); return findProject(o!, n!)! }))
const suggested = ['kwesi', 'nanayaa', 'efua'].map(h => PEOPLE[h]!)
const open = QUESTIONS.filter(q => !q.solved).slice(0, 3)
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto flex max-w-[1320px] justify-center">
      <!-- Left rail -->
      <header class="hidden md:flex sticky top-0 h-screen w-[76px] xl:w-[260px] shrink-0 flex-col justify-between py-3 px-2 xl:px-4">
        <div>
          <RouterLink to="/reef" class="flex items-center gap-2.5 rounded-full px-3 py-2.5 mb-2 hover:bg-elevated transition-colors" aria-label="The Reef home">
            <span class="text-2xl leading-none">🦞</span>
            <span class="hidden xl:block text-lg font-semibold tracking-tight text-highlighted">The Reef</span>
          </RouterLink>
          <nav class="space-y-0.5" aria-label="The Reef">
            <RouterLink
              v-for="n in NAV"
              :key="n.label"
              :to="n.to"
              class="flex items-center gap-4 rounded-full px-3 py-2.5 text-[17px] transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :class="active(n) ? 'font-semibold text-highlighted' : 'text-default'"
              :aria-current="active(n) ? 'page' : undefined"
            >
              <UIcon :name="n.icon" class="size-6 shrink-0" :class="active(n) ? 'text-primary' : ''" />
              <span class="hidden xl:block">{{ n.label }}</span>
            </RouterLink>
          </nav>
          <UButton class="mt-4 hidden xl:flex w-full justify-center" label="Share a project" size="xl" color="neutral" icon="i-lucide-plus" />
          <UButton class="mt-4 xl:hidden mx-auto flex" icon="i-lucide-plus" size="xl" color="neutral" square aria-label="Share a project" />
        </div>
        <div class="space-y-1">
          <RouterLink to="/" class="flex items-center gap-4 rounded-full px-3 py-2.5 text-sm text-muted hover:bg-elevated transition-colors">
            <UIcon name="i-lucide-arrow-left" class="size-5 shrink-0" /><span class="hidden xl:block">Back to OpenLobs</span>
          </RouterLink>
          <RouterLink :to="`/reef/u/${me.handle}`" class="flex items-center gap-3 rounded-full px-2 py-2 hover:bg-elevated transition-colors">
            <ReefAvatar :name="me.name" :size="38" />
            <span class="hidden xl:block min-w-0 text-sm leading-tight"><span class="block font-semibold text-highlighted truncate">{{ me.name }}</span><span class="block text-muted truncate">@{{ me.handle }}</span></span>
          </RouterLink>
        </div>
      </header>

      <!-- Centre -->
      <main class="min-h-screen w-full border-x border-default pb-20 md:pb-0" :class="wide ? 'max-w-[1040px]' : 'max-w-[640px]'">
        <div v-if="title || $slots.header" class="sticky top-0 z-20 bg-default/80 backdrop-blur-md border-b border-default">
          <div class="flex items-center gap-3 px-4 h-14">
            <RouterLink v-if="back" to="/reef" class="rounded-full p-2 -ml-2 hover:bg-elevated transition-colors" aria-label="Back"><UIcon name="i-lucide-arrow-left" class="size-5" /></RouterLink>
            <h1 class="text-lg font-semibold text-highlighted truncate">{{ title }}</h1>
            <div class="ml-auto"><slot name="action" /></div>
          </div>
          <slot name="header" />
        </div>
        <slot />
      </main>

      <!-- Right rail -->
      <aside v-if="!wide" class="hidden lg:block w-[340px] shrink-0 px-6 py-3">
        <div class="sticky top-3 space-y-4">
          <div class="flex items-center gap-2 rounded-full bg-elevated px-4 py-2.5 text-muted focus-within:ring-2 focus-within:ring-primary">
            <UIcon name="i-lucide-search" class="size-4" />
            <input class="bg-transparent outline-none text-sm w-full placeholder:text-dimmed" placeholder="Search The Reef" aria-label="Search The Reef">
          </div>

          <section class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="trend">
            <h2 id="trend" class="px-4 pb-1 text-lg font-bold text-highlighted">Trending projects</h2>
            <RouterLink v-for="p in trending" :key="p.name" :to="`/reef/${p.owner}/${p.name}`" class="block px-4 py-2.5 hover:bg-elevated transition-colors">
              <p class="text-xs text-muted">{{ p.kind === 'task' ? 'Task' : p.kind[0]!.toUpperCase() + p.kind.slice(1) }} · {{ fmt(p.stars) }} stars</p>
              <p class="text-[15px] font-semibold text-highlighted">{{ p.owner }}/{{ p.name }}</p>
            </RouterLink>
          </section>

          <section class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="follow">
            <h2 id="follow" class="px-4 pb-1 text-lg font-bold text-highlighted">Who to follow</h2>
            <div v-for="p in suggested" :key="p.handle" class="flex items-center gap-3 px-4 py-2.5">
              <ReefAvatar :name="p.name" :size="40" />
              <div class="min-w-0 flex-1 text-sm leading-tight">
                <ReefName :person="p" :handle="false" />
                <p class="text-muted truncate">@{{ p.handle }}</p>
              </div>
              <UButton label="Follow" size="sm" color="neutral" class="rounded-full" />
            </div>
          </section>

          <section class="rounded-2xl bg-elevated/60 py-3" aria-labelledby="oq">
            <h2 id="oq" class="px-4 pb-1 text-lg font-bold text-highlighted">Open questions</h2>
            <RouterLink v-for="q in open" :key="q.id" to="/reef/questions" class="block px-4 py-2.5 hover:bg-elevated transition-colors">
              <p class="text-[15px] text-highlighted line-clamp-2">{{ q.title }}</p>
              <p class="text-xs text-muted mt-0.5">{{ q.answers }} {{ q.answers === 1 ? 'answer' : 'answers' }} · {{ q.when }}</p>
            </RouterLink>
          </section>
          <p class="px-2 text-xs text-dimmed">Open source · MIT · Made in Ghana</p>
        </div>
      </aside>
    </div>

    <!-- Phone: bottom bar -->
    <nav class="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-default bg-default/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]" aria-label="The Reef">
      <div class="flex items-center justify-around h-14">
        <RouterLink v-for="n in NAV.filter(x => x.label !== 'Alerts')" :key="n.label" :to="n.to" class="flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] transition-colors" :class="active(n) ? 'text-highlighted font-semibold' : 'text-muted'" :aria-label="n.label">
          <UIcon :name="n.icon" class="size-6" :class="active(n) ? 'text-primary' : ''" />{{ n.label }}
        </RouterLink>
      </div>
    </nav>
    <button type="button" class="md:hidden fixed right-4 bottom-20 z-30 size-14 rounded-full bg-primary text-inverted shadow-lg flex items-center justify-center active:scale-95 transition-transform" aria-label="Share a project">
      <UIcon name="i-lucide-plus" class="size-6" />
    </button>
  </div>
</template>
