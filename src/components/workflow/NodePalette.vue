<script setup lang="ts">
import { ref, computed } from 'vue'
import { NODE_CATEGORIES } from '../../utils/workflowNodes'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'add-node', node: any): void
}>()

const searchQuery = ref('')

const filteredCategories = computed(() => {
  if (!searchQuery.value) return NODE_CATEGORIES

  const query = searchQuery.value.toLowerCase()
  
  return NODE_CATEGORIES.map(category => ({
    ...category,
    nodes: category.nodes.filter(node => 
      node.title.toLowerCase().includes(query) || 
      (node.subtitle ?? "").toLowerCase().includes(query)
    )
  })).filter(category => category.nodes.length > 0)
})

const onDragStart = (event: DragEvent, nodeType: any) => {
  if (nodeType.comingSoon) {
    event.preventDefault()
    return
  }
  if (event.dataTransfer) {
    event.dataTransfer.setData('application/vueflow', JSON.stringify(nodeType))
    event.dataTransfer.effectAllowed = 'move'
  }
}

const handleNodeSelect = (node: any) => {
  if (node.comingSoon) return
  emit('add-node', node)
}
</script>

<template>
  <div class="flex flex-col h-full bg-elevated border-r border-default shrink-0 w-[85vw] sm:w-80 lg:w-64 overflow-hidden">
    <div class="p-3 border-b border-default shrink-0">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-library" class="size-4 text-primary" />
          <span class="font-semibold text-sm text-default">Node Library</span>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          size="xs"
          class="lg:hidden"
          @click="emit('close')"
          aria-label="Close library"
        />
      </div>
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search or tap to add..."
        size="sm"
        class="w-full"
      />
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-5">
      <div v-for="category in filteredCategories" :key="category.id">
        <div class="flex items-center gap-2 mb-2 px-1">
          <UIcon :name="category.icon" class="size-3.5 text-muted" />
          <h4 class="text-xs font-semibold text-default tracking-wide uppercase">{{ category.label }}</h4>
        </div>
        
        <div class="space-y-1">
          <div
            v-for="node in category.nodes"
            :key="node.subtype"
            :draggable="!node.comingSoon"
            :aria-disabled="node.comingSoon || undefined"
            :title="node.comingSoon ? `${node.title} is not available yet` : undefined"
            @dragstart="onDragStart($event, node)"
            @click="handleNodeSelect(node)"
            class="group flex items-center justify-between p-2 rounded-lg transition-all border border-transparent"
            :class="node.comingSoon
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:bg-accented/50 hover:border-default/50 active:scale-[0.98] cursor-pointer sm:cursor-grab sm:active:cursor-grabbing'"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="size-7 rounded-md bg-default border border-default flex items-center justify-center shrink-0">
                <UIcon :name="node.icon" class="size-4 transition-colors" :class="[node.color || 'text-default']" />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-default truncate">{{ node.title }}</div>
                <div class="text-[10px] text-muted truncate">{{ node.subtitle }}</div>
              </div>
            </div>
            <UBadge
              v-if="node.comingSoon"
              label="Soon"
              color="neutral"
              variant="subtle"
              size="sm"
              class="shrink-0 ml-1"
            />
            <UIcon
              v-else
              name="i-lucide-plus"
              class="size-3.5 text-muted opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-1"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
