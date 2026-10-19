<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useChats } from '../composables/useChats'
import { useUserSession } from '../composables/useUserSession'
import { useChatActions } from '../composables/useChatActions'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import ModalAuth from '../components/ModalAuth.vue'

const router = useRouter()
const route = useRoute()
const { loggedIn, fetchSession } = useUserSession()
const { groups, fetchChats } = useChats()
const { renameChat, deleteChat } = useChatActions()
const { openAuthModal } = useFirebaseAuth()

onMounted(() => {
  fetchSession()
  fetchChats()
})

const sidebarOpen = ref(false)
const searchOpen = ref(false)

watch(loggedIn, () => {
  fetchChats()

  sidebarOpen.value = false
})

const items = computed(() => groups.value?.flatMap((group) => {
  return [{
    label: group.label,
    type: 'label' as const
  }, ...group.items.map(item => ({
    ...item,
    slot: 'chat' as const,
    icon: undefined,
    class: item.label === 'Untitled' ? 'text-muted' : ''
  }))]
}))

function getChatActions(item: { id: string, label: string }): DropdownMenuItem[][] {
  return [[
    {
      label: 'Rename',
      icon: 'i-lucide-pencil',
      onSelect: () => renameChat(item.id, item.label === 'Untitled' ? '' : item.label)
    }
  ], [
    {
      label: 'Delete',
      icon: 'i-lucide-trash',
      color: 'error' as const,
      onSelect: () => deleteChat(item.id)
    }
  ]]
}

defineShortcuts({
  meta_o: () => {
    router.push('/')
  }
})
</script>

<template>
  <UDashboardGroup
    unit="rem"
    class="w-full h-full min-h-[100dvh] overflow-hidden"
  >
    <UDashboardSidebar
      id="default"
      v-model:open="sidebarOpen"
      :min-size="12"
      collapsible
      resizable
      class="py-4"
    >
      <template #header="{ collapsed }">
        <ULink
          v-if="!collapsed"
          to="/"
          class="flex items-center gap-0.5 outline-primary/25 focus-visible:outline-3 rounded-md"
        >
          <img
            src="/favicon.svg"
            alt=""
            class="size-6 shrink-0"
          >
          <span class="text-xl font-bold text-highlighted">OpenLobs</span>
        </ULink>

        <UDashboardSidebarCollapse class="ms-auto" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="[{
            label: 'New chat',
            to: '/',
            kbds: ['meta', 'o'],
            icon: 'i-lucide-circle-plus'
          }, {
            label: 'Search',
            icon: 'i-lucide-search',
            kbds: ['meta', 'k'],
            onSelect: () => {
              searchOpen = true
            }
          }, {
            label: 'Agents',
            to: '/agents',
            icon: 'i-lucide-bot'
          }, {
            label: 'Workflow Studio',
            to: '/workflows',
            icon: 'i-lucide-workflow'
          }, {
            label: 'Integrations',
            to: '/integrations',
            icon: 'i-lucide-blocks'
          }]"
          :collapsed="collapsed"
          orientation="vertical"
        >
          <template #item-trailing="{ item }">
            <div
              v-if="item.kbds?.length"
              class="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <UKbd
                v-for="kbd in item.kbds"
                :key="kbd"
                :value="kbd"
                size="sm"
                variant="soft"
                class="bg-accented/50"
              />
            </div>
          </template>
        </UNavigationMenu>

        <UNavigationMenu
          v-if="!collapsed"
          :items="items"
          :collapsed="collapsed"
          orientation="vertical"
          :ui="{
            link: 'overflow-hidden pr-7.5',
            linkTrailing: 'translate-x-full group-hover:translate-x-0 group-has-data-[state=open]:translate-x-0 transition-transform ms-0 absolute inset-e-px'
          }"
        >
          <template #chat-trailing="{ item }">
            <UDropdownMenu
              :items="getChatActions(item as { id: string, label: string })"
              :content="{ align: 'end' }"
            >
              <UButton
                as="div"
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="link"
                size="sm"
                class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
                aria-label="Chat actions"
                tabindex="-1"
                @click.stop.prevent
              />
            </UDropdownMenu>
          </template>
        </UNavigationMenu>
      </template>

      <template #footer="{ collapsed }">
        <UserMenu
          v-if="loggedIn"
          :collapsed="collapsed"
        />
        <UButton
          v-else
          :label="collapsed ? '' : 'Sign in'"
          icon="i-lucide-log-in"
          color="neutral"
          variant="ghost"
          class="w-full"
          @click="openAuthModal"
        />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch
      v-model:open="searchOpen"
      placeholder="Search chats..."
      :groups="[{
        id: 'links',
        items: [{
          label: 'New chat',
          to: '/',
          icon: 'i-lucide-circle-plus'
        }]
      }, ...groups]"
    />

    <div class="flex-1 flex min-w-0 h-full overflow-hidden">
      <RouterView :key="route.path" v-slot="{ Component }">
        <template v-if="Component">
          <Suspense>
            <component :is="Component" />
            <template #fallback>
              <div class="flex items-center justify-center w-full h-full">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>
            </template>
          </Suspense>
        </template>
      </RouterView>
    </div>

    <ModalAuth />
  </UDashboardGroup>
</template>
