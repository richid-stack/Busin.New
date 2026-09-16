const fs = require('fs')

const file = 'src/pages/workflows/index.vue'
let content = fs.readFileSync(file, 'utf8')

// Add state
if (!content.includes('isCopilotOpen')) {
  content = content.replace(
    'const isPropertiesPanelOpen = ref(true)',
    'const isPropertiesPanelOpen = ref(true)\nconst isCopilotOpen = ref(false)\nconst copilotPrompt = ref("")\nconst isCopilotLoading = ref(false)\nconst copilotChat = ref([{ role: "assistant", text: "Hi! I am your AI Workflow Copilot. How can I help you modify this graph?" }])'
  )

  const copilotMethod = `
async function runCopilot() {
  if (!copilotPrompt.value.trim() || isCopilotLoading.value) return
  const userText = copilotPrompt.value
  copilotChat.value.push({ role: 'user', text: userText })
  copilotPrompt.value = ''
  isCopilotLoading.value = true
  
  try {
    const res = await $fetch('/api/workflows/copilot', {
      method: 'POST',
      headers: getHeaders(),
      body: {
        prompt: userText,
        nodes: nodes.value,
        edges: edges.value
      }
    })
    
    if (res.success && res.nodes) {
      nodes.value = res.nodes
      edges.value = res.edges
      copilotChat.value.push({ role: 'assistant', text: res.summary || 'I have updated the canvas based on your request.' })
      setTimeout(layoutGraph, 50)
    }
  } catch (err) {
    copilotChat.value.push({ role: 'assistant', text: 'Sorry, I encountered an error modifying the graph.' })
    console.error(err)
  } finally {
    isCopilotLoading.value = false
  }
}
`
  content = content.replace('const onNodeClick =', copilotMethod + '\nconst onNodeClick =')

  const copilotButton = `          <div class="w-px h-4 bg-default"></div>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-sparkles"
            size="xs"
            @click="isCopilotOpen = !isCopilotOpen"
            title="AI Copilot"
          />`

  content = content.replace('<div class="w-px h-4 bg-default"></div>', copilotButton)

  const copilotUI = `
      <!-- AI Copilot Drawer -->
      <div 
        v-if="isCopilotOpen" 
        class="w-80 border-l border-default bg-elevated h-full flex flex-col shrink-0 z-30 absolute right-0 top-0 bottom-0 shadow-2xl"
        :class="{ 'right-96': isPropertiesPanelOpen }"
      >
        <div class="p-4 border-b border-default flex items-center justify-between bg-primary/5">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
            <h3 class="font-semibold text-sm">AI Copilot</h3>
          </div>
          <UButton 
            color="neutral" 
            variant="ghost" 
            icon="i-lucide-x" 
            size="xs" 
            @click="isCopilotOpen = false" 
          />
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <div v-for="(msg, i) in copilotChat" :key="i" class="flex flex-col gap-1" :class="msg.role === 'user' ? 'items-end' : 'items-start'">
            <div 
              class="px-3 py-2 rounded-xl max-w-[90%]"
              :class="msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/10 text-foreground border border-default'"
            >
              {{ msg.text }}
            </div>
          </div>
          <div v-if="isCopilotLoading" class="flex items-start gap-1">
            <div class="px-3 py-2 rounded-xl bg-muted/10 text-foreground border border-default">
              <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary" />
            </div>
          </div>
        </div>

        <div class="p-3 border-t border-default bg-background">
          <UInput
            v-model="copilotPrompt"
            placeholder="E.g. Add a slack alert node"
            size="sm"
            @keyup.enter="runCopilot"
            :disabled="isCopilotLoading"
            class="w-full"
          >
            <template #trailing>
              <UButton
                color="primary"
                variant="ghost"
                icon="i-lucide-send"
                size="xs"
                :loading="isCopilotLoading"
                @click="runCopilot"
              />
            </template>
          </UInput>
        </div>
      </div>
`
  content = content.replace('<!-- Properties Panel (Right Drawer) -->', copilotUI + '\n      <!-- Properties Panel (Right Drawer) -->')

  fs.writeFileSync(file, content)
}
