<script setup lang="ts">
import { computed } from 'vue'
import { getToolName } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { mcpLogo } from '../../../utils/mcpLogo'

const props = defineProps<{
  part: any
}>()

const toolName = computed(() => getToolName(props.part) || 'tool')
const streaming = computed(() => isToolStreaming(props.part))

// Tools from an MCP server are named mcp_<server>_<tool>.
const isMcp = computed(() => toolName.value.startsWith('mcp_'))
const formattedName = computed(() => {
  return (isMcp.value ? toolName.value.slice(4) : toolName.value).replace(/_/g, ' ')
})

const summary = computed(() => {
  const input = props.part.input
  if (!input) return undefined
  if (typeof input === 'string') return input.slice(0, 40)
  if (typeof input === 'object') {
    const keys = Object.keys(input)
    if (keys.length === 1 && typeof input[keys[0]!] === 'string') {
      return String(input[keys[0]!]).slice(0, 40)
    }
  }
  return undefined
})

const formattedOutput = computed(() => {
  if (!props.part.output) return null
  if (typeof props.part.output === 'string') return props.part.output
  try {
    return JSON.stringify(props.part.output, null, 2)
  } catch {
    return String(props.part.output)
  }
})
</script>

<template>
  <UChatTool
    :text="isMcp ? (streaming ? `Using ${formattedName}...` : props.part.output?.status === 'failed' ? `Could not use ${formattedName}` : `Used ${formattedName}`) : (streaming ? `Running ${formattedName}...` : `Completed ${formattedName}`)"
    :suffix="summary"
    :streaming="streaming"
    :icon="isMcp ? (mcpLogo(toolName) ?? 'i-lucide-plug') : 'i-lucide-wrench'"
    chevron="leading"
  >
    <div
      v-if="formattedOutput"
      class="p-2.5 border border-default rounded-md bg-elevated/40 text-xs font-mono max-h-48 overflow-y-auto"
    >
      <pre class="whitespace-pre-wrap text-muted">{{ formattedOutput }}</pre>
    </div>
  </UChatTool>
</template>
