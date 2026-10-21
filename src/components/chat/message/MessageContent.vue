<script setup lang="ts">
import { isReasoningUIPart, isTextUIPart, isToolUIPart, isFileUIPart, getToolName } from 'ai'
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
import ChatToolWorkflowApproval from '../tool/WorkflowApproval.vue'
import ChatToolIntegrationExecute from '../tool/IntegrationExecute.vue'
import ChatMessageEdit from './MessageEdit.vue'
import { getMergedParts } from '../../../utils/ai'
import { getFetchedPage, getSearchProblem, getSearchQuery, getSources } from '../../../utils/tool'
import type { WeatherUIToolInvocation } from '../../../../server/utils/tools/weather'
import type { ChartUIToolInvocation } from '../../../../server/utils/tools/chart'
import type { PlanUIToolInvocation } from '../../../../server/utils/tools/plan'
import type { CalculatorUIToolInvocation } from '../../../../server/utils/tools/calculator'

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
  <div
    v-if="message.parts?.some(isFileUIPart)"
    class="flex flex-wrap gap-2 mb-2"
  >
    <template
      v-for="(part, index) in message.parts.filter(isFileUIPart)"
      :key="`attachment-${index}`"
    >
      <img
        v-if="part.mediaType?.startsWith('image/')"
        :src="part.url"
        class="w-48 max-w-full rounded-xl object-contain shadow-sm border border-default"
        :alt="part.filename || 'Attached image'"
      >
      <div
        v-else
        class="flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-xs overflow-hidden"
      >
        <UIcon
          :name="part.mediaType === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-file'"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">{{ part.filename || 'Attachment' }}</span>
      </div>
    </template>
  </div>

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
        :text="isToolStreaming(part) ? 'Searching the web...' : getSearchProblem(part) === 'failed' ? 'Web search unavailable' : getSearchProblem(part) === 'empty' ? 'No results found' : 'Searched the web'"
        :suffix="getSearchQuery(part)"
        :streaming="isToolStreaming(part)"
        chevron="leading"
      >
        <ChatToolSources :sources="getSources(part)" />
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'web_fetch'"
        :text="isToolStreaming(part) ? 'Reading the page...' : getFetchedPage(part).failed ? 'Could not read the page' : 'Read the page'"
        :suffix="getFetchedPage(part).url"
        :streaming="isToolStreaming(part)"
        chevron="leading"
      >
        <ChatToolSources :sources="getFetchedPage(part).source ? [getFetchedPage(part).source!] : []" />
      </UChatTool>
      <ChatToolWorkflowCreate
        v-else-if="getToolName(part) === 'workflow_create'"
        :invocation="part"
      />
      <ChatToolWorkflowApproval
        v-else-if="getToolName(part) === 'workflow_approval'"
        :invocation="part"
      />
      <ChatToolWorkflowRun
        v-else-if="getToolName(part) === 'workflow_run'"
        :invocation="part"
      />
      <ChatToolIntegrationExecute
        v-else-if="getToolName(part) === 'integration_execute'"
        :invocation="part"
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

  </template>
</template>
