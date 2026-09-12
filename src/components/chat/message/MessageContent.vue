<script setup lang="ts">
import { isReasoningUIPart, isTextUIPart, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { isPartStreaming, isToolStreaming } from '@nuxt/ui/utils/ai'
import ChatComark from '../Comark'
import ChatToolChart from '../tool/Chart.vue'
import ChatToolWeather from '../tool/Weather.vue'
import ChatToolSources from '../tool/Sources.vue'
import ChatToolPlan from '../tool/Plan.vue'
import ChatToolCalculator from '../tool/Calculator.vue'
import ChatToolGeneric from '../tool/Generic.vue'
import ChatToolWorkflowCreate from '../tool/WorkflowCreate.vue'
import ChatToolWorkflowRun from '../tool/WorkflowRun.vue'
import ChatMessageEdit from './MessageEdit.vue'
import { getMergedParts } from '../../../utils/ai'
import { getSearchQuery, getSources } from '../../../utils/tool'
import type { WeatherUIToolInvocation } from '../../../../server/utils/tools/weather'
import type { ChartUIToolInvocation } from '../../../../server/utils/tools/chart'
import type { PlanUIToolInvocation } from '../../../../server/utils/tools/plan'
import type { CalculatorUIToolInvocation } from '../../../../server/utils/tools/calculator'
import type { ToolInvocation } from 'ai'

defineProps<{
  message: UIMessage
  editing: boolean
}>()

const emit = defineEmits<{
  save: [message: UIMessage, text: string]
  cancelEdit: []
}>()
</script>

<template>
  <template v-if="message.experimental_attachments?.length">
    <div class="flex flex-wrap gap-2 mb-2">
      <template
        v-for="(attachment, index) in message.experimental_attachments"
        :key="`attachment-${index}`"
      >
        <img
          v-if="attachment.contentType?.includes('image')"
          :src="attachment.url"
          class="w-48 max-w-full rounded-xl object-contain shadow-sm border border-default"
          alt="Attached image"
        />
        <div
          v-else
          class="flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-xs overflow-hidden"
        >
          <UIcon
            name="i-lucide-file"
            class="size-4 shrink-0 text-muted"
          />
          <span class="truncate">
            {{ attachment.name || (typeof attachment.url === 'string' && attachment.url.startsWith('data:') ? 'Attachment' : (attachment.url?.split('/').pop() || 'Attachment')) }}
          </span>
        </div>
      </template>
    </div>
  </template>

  <template v-if="message.parts?.some(p => p.type === 'image' || p.type === 'file')">
    <div class="flex flex-wrap gap-2 mb-2">
      <template
        v-for="(part, index) in message.parts.filter(p => p.type === 'image' || p.type === 'file')"
        :key="`part-attachment-${index}`"
      >
        <img
          v-if="part.type === 'image' || part.mimeType?.includes('image') || part.mediaType?.includes('image')"
          :src="part.data || part.url"
          class="w-48 max-w-full rounded-xl object-contain shadow-sm border border-default"
          alt="Attached image"
        />
        <div
          v-else
          class="flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-xs overflow-hidden"
        >
          <UIcon
            name="i-lucide-file"
            class="size-4 shrink-0 text-muted"
          />
          <span class="truncate">
            {{ part.name || part.filename || 'Attachment' }}
          </span>
        </div>
      </template>
    </div>
  </template>

  <template
    v-for="(part, index) in getMergedParts(message.parts || [])"
    :key="`${message.id}-${part.type}-${index}`"
  >
    <UChatReasoning
      v-if="isReasoningUIPart(part)"
      :text="part.text"
      :streaming="isPartStreaming(part)"
      chevron="leading"
    >
      <ChatComark
        :value="part.text"
        :streaming="isPartStreaming(part)"
      />
    </UChatReasoning>

    <template v-else-if="isToolUIPart(part)">
      <ChatToolChart
        v-if="getToolName(part) === 'chart'"
        :invocation="{ ...(part as ChartUIToolInvocation) }"
      />
      <ChatToolWeather
        v-else-if="getToolName(part) === 'weather'"
        :invocation="{ ...(part as WeatherUIToolInvocation) }"
      />
      <ChatToolPlan
        v-else-if="getToolName(part) === 'plan'"
        :invocation="{ ...(part as PlanUIToolInvocation) }"
      />
      <ChatToolCalculator
        v-else-if="getToolName(part) === 'calculator'"
        :invocation="{ ...(part as CalculatorUIToolInvocation) }"
      />
      <UChatTool
        v-else-if="getToolName(part) === 'web_search' || getToolName(part) === 'google_search'"
        :text="isToolStreaming(part) ? 'Searching the web...' : 'Searched the web'"
        :suffix="getSearchQuery(part)"
        :streaming="isToolStreaming(part)"
        chevron="leading"
      >
        <ChatToolSources :sources="getSources(part)" />
      </UChatTool>
      <ChatToolWorkflowCreate
        v-else-if="getToolName(part) === 'workflow_create'"
        :invocation="{ ...(part as unknown as ToolInvocation) }"
      />
      <ChatToolWorkflowRun
        v-else-if="getToolName(part) === 'workflow_run'"
        :invocation="{ ...(part as unknown as ToolInvocation) }"
      />
      <ChatToolGeneric
        v-else
        :part="part"
      />
    </template>

    <template v-else-if="isTextUIPart(part)">
      <ChatComark
        v-if="message.role === 'assistant'"
        :value="part.text"
        :streaming="isPartStreaming(part)"
      />
      <template v-else-if="message.role === 'user'">
        <ChatMessageEdit
          v-if="editing"
          :message="message"
          :text="part.text"
          @save="(msg, text) => emit('save', msg, text)"
          @cancel="emit('cancelEdit')"
        />
        <p
          v-else
          class="whitespace-pre-wrap"
        >
          {{ part.text }}
        </p>
      </template>
    </template>

    <template v-else-if="part.type === 'file' || part.type === 'image' || part.type === 'image-url' || part.type === 'file-url' || 'url' in part">
      <div class="flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-xs mb-2">
        <UIcon
          :name="part.type?.includes('image') || (part as any).mimeType?.includes('image') ? 'i-lucide-image' : 'i-lucide-file'"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">
          {{ typeof (part as any).url === 'string' && (part as any).url.startsWith('data:') ? 'Attachment' : ((part as any).url?.split('/').pop() || (part as any).name || 'Attachment') }}
        </span>
      </div>
    </template>
  </template>
</template>
