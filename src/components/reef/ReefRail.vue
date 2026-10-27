<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useReefMe } from '../../composables/useReefMe'
import { useReefUi } from '../../composables/useReefUi'
import ReefAvatar from './ReefAvatar.vue'

/** The left column: where you are, and what you can do. On a phone the same thing slides in from the left. */
const props = withDefaults(defineProps<{ expanded?: boolean }>(), { expanded: false })
const emit = defineEmits<{ go: [] }>()

const route = useRoute()
const { profile, unread, admin, signedIn, requireProfile } = useReefMe()
const { openPublish } = useReefUi()
const { openAuthModal } = useFirebaseAuth()

const label = computed(() => (props.expanded ? 'block' : 'hidden xl:block'))

const NAV = computed(() => [
  { label: 'Home', icon: 'i-lucide-house', to: '/reef', on: route.path === '/reef' },
  { label: 'Projects', icon: 'i-lucide-boxes', to: '/reef/projects', on: route.path.startsWith('/reef/projects') || (/^\/reef\/[^/]+\/[^/]+$/.test(route.path) && !/^\/reef\/(u|post)\//.test(route.path)) },
  { label: 'Questions', icon: 'i-lucide-circle-help', to: '/reef/questions', on: route.path.startsWith('/reef/questions') },
  { label: 'Alerts', icon: 'i-lucide-bell', to: '/reef/alerts', on: route.path.startsWith('/reef/alerts'), badge: unread.value },
  ...(profile.value ? [{ label: 'Profile', icon: 'i-lucide-user-round', to: `/reef/u/${profile.value.handle}`, on: route.path === `/reef/u/${profile.value.handle}` }] : []),
  ...(admin.value ? [{ label: 'Review', icon: 'i-lucide-shield-check', to: '/reef/review', on: route.path.startsWith('/reef/review') }] : [])
])

const share = () => { emit('go'); if (requireProfile(() => openPublish())) openPublish() }
</script>

<template>
  <div class="flex h-full flex-col justify-between py-3" :class="expanded ? 'px-4' : 'px-2 xl:px-4'">
    <div>
      <RouterLink to="/reef" class="flex items-center gap-2.5 rounded-full px-3 py-2.5 mb-2 hover:bg-elevated transition-colors" aria-label="The Reef home" @click="emit('go')">
        <span class="text-2xl leading-none">🦞</span>
        <span class="text-lg font-semibold tracking-tight text-highlighted" :class="label">The Reef</span>
      </RouterLink>
      <nav class="space-y-0.5" aria-label="The Reef">
        <RouterLink
          v-for="n in NAV"
          :key="n.label"
          :to="n.to"
          class="relative flex items-center gap-4 rounded-full px-3 py-2.5 text-[17px] transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
          :class="n.on ? 'font-semibold text-highlighted' : 'text-default'"
          :aria-current="n.on ? 'page' : undefined"
          @click="emit('go')"
        >
          <span class="relative shrink-0">
            <UIcon :name="n.icon" class="size-6" :class="n.on ? 'text-primary' : ''" />
            <span v-if="n.badge" class="absolute -top-1 -right-1.5 min-w-4 h-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-inverted text-center" :aria-label="`${n.badge} unread`">{{ n.badge > 9 ? '9+' : n.badge }}</span>
          </span>
          <span :class="label">{{ n.label }}</span>
        </RouterLink>
      </nav>
      <UButton v-if="expanded" class="mt-4 w-full justify-center" label="Share a project" size="xl" color="neutral" icon="i-lucide-plus" @click="share" />
      <template v-else>
        <UButton class="mt-4 hidden xl:flex w-full justify-center" label="Share a project" size="xl" color="neutral" icon="i-lucide-plus" @click="share" />
        <UButton class="mt-4 xl:hidden mx-auto flex" icon="i-lucide-plus" size="xl" color="neutral" square aria-label="Share a project" @click="share" />
      </template>
    </div>

    <div class="space-y-1">
      <RouterLink to="/" class="flex items-center gap-4 rounded-full px-3 py-2.5 text-sm text-muted hover:bg-elevated transition-colors" @click="emit('go')">
        <UIcon name="i-lucide-arrow-left" class="size-5 shrink-0" /><span :class="label">Back to OpenLobs</span>
      </RouterLink>
      <RouterLink v-if="profile" :to="`/reef/u/${profile.handle}`" class="flex items-center gap-3 rounded-full px-2 py-2 hover:bg-elevated transition-colors" @click="emit('go')">
        <ReefAvatar :name="profile.name" :size="38" />
        <span class="min-w-0 text-sm leading-tight" :class="label"><span class="block font-semibold text-highlighted truncate">{{ profile.name }}</span><span class="block text-muted truncate">@{{ profile.handle }}</span></span>
      </RouterLink>
      <button v-else-if="signedIn" type="button" class="flex w-full items-center gap-3 rounded-full px-2 py-2 hover:bg-elevated transition-colors text-left" @click="requireProfile(); emit('go')">
        <span class="size-[38px] shrink-0 rounded-full border border-dashed border-default flex items-center justify-center text-muted"><UIcon name="i-lucide-user-plus" class="size-4" /></span>
        <span class="text-sm font-medium text-highlighted" :class="label">Set up your profile</span>
      </button>
      <button v-else type="button" class="flex w-full items-center gap-3 rounded-full px-2 py-2 hover:bg-elevated transition-colors text-left" @click="openAuthModal(); emit('go')">
        <span class="size-[38px] shrink-0 rounded-full border border-default flex items-center justify-center text-muted"><UIcon name="i-lucide-log-in" class="size-4" /></span>
        <span class="text-sm font-medium text-highlighted" :class="label">Sign in to join</span>
      </button>
    </div>
  </div>
</template>
