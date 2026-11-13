<script setup lang="ts">
import { computed } from 'vue'
import { isReasoningUIPart, isTextUIPart, isToolUIPart, isFileUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { isPartStreaming, isToolStreaming } from '@nuxt/ui/utils/ai'
import ChatComark from '../Comark'
import ChatToolChart from '../tool/Chart.vue'
import FileImage from '../tool/FileImage.vue'
import ChatToolWeather from '../tool/Weather.vue'
import ChatToolSources from '../tool/Sources.vue'
import ChatToolPlan from '../tool/Plan.vue'
import ChatToolCalculator from '../tool/Calculator.vue'
import ChatToolGeneric from '../tool/Generic.vue'
import ChatToolMemory from '../tool/Memory.vue'
import ChatToolAgentProposal from '../tool/AgentProposal.vue'
import ChatToolWorkflowCreate from '../tool/WorkflowCreate.vue'
import ChatToolWorkflowRun from '../tool/WorkflowRun.vue'
import ChatToolFile from '../tool/File.vue'
import ChatToolEditFile from '../tool/EditFile.vue'
import ChatToolProjectFile from '../tool/ProjectFile.vue'
import ChatToolInspection from '../tool/Inspection.vue'
import ChatToolComputerExcel from '../tool/ComputerExcel.vue'
import ChatToolTaskProposal from '../tool/TaskProposal.vue'
import ChatToolWorkflowApproval from '../tool/WorkflowApproval.vue'
import ChatToolIntegrationExecute from '../tool/IntegrationExecute.vue'
import ChatToolApproval from '../tool/Approval.vue'
import ChatToolBrowserView from '../tool/BrowserView.vue'
import ChatToolBrowserStep from '../tool/BrowserStep.vue'
import { approvalInstruction, controlsBefore, hostBefore } from '../../../utils/browserTrace'
import ChatMessageEdit from './MessageEdit.vue'
import { getMergedParts } from '../../../utils/ai'
import { attachmentIcon } from '../../../utils/attachmentTypes'
import { getDocumentRead, getFetchedPage, getFileTrace, getRowsTrace, getLookupTrace, getPageTrace, getRunTrace, getSearchProblem, getSearchQuery, getSkillName, getSources } from '../../../utils/tool'
import type { WeatherUIToolInvocation } from '../../../../server/utils/tools/weather'
import { withoutSourceMarks } from '../../../../shared/modelText'
import type { ChartUIToolInvocation } from '../../../../server/utils/tools/chart'
import type { PlanUIToolInvocation } from '../../../../server/utils/tools/plan'
import type { CalculatorUIToolInvocation } from '../../../../server/utils/tools/calculator'

const props = defineProps<{
  message: UIMessage
  editing: boolean
  /** The chat this message is in, and whether it is the reply in front of the person (only that one shows the browser live). */
  chatId?: string
  live?: boolean
  working?: boolean
}>()

/** All the browser steps in this reply: they are shown together, as one card, where the first one is. */
const browserParts = computed(() => (props.message.parts ?? []).filter(p => isToolUIPart(p) && getToolName(p) === 'browser'))

const emit = defineEmits<{
  save: [message: UIMessage, text: string]
  cancelEdit: []
}>()

function isToolPart(part: any): boolean {
  return typeof part?.type === 'string' && (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
}
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
          :name="attachmentIcon(part.mediaType)"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">{{ part.filename || 'Attachment' }}</span>
      </div>
    </template>
  </div>

  <template
    v-for="(part, index) in getMergedParts(message.parts || [])"
    :key="`${message.id}-${part.type}-${index}${isToolPart(part) ? `-${(part as { state?: string }).state}` : ''}`"
  >
    <!-- Tool parts are updated in place as results arrive. Keying them by state makes each row draw again when its state changes, so no row stays on "Running", "Drafting" or empty until the chat is reloaded. -->
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
      <!-- Browser steps: the live page once, at the first step; every step is its own trace line. -->
      <ChatToolBrowserView
        v-if="getToolName(part) === 'browser' && part === browserParts[0]"
        :chat-id="chatId || ''"
        :live="Boolean(live && chatId)"
        :working="Boolean(working)"
      />
      <ChatToolApproval
        v-if="part.state === 'approval-requested'"
        :part="part"
        :instruction="getToolName(part) === 'browser' ? approvalInstruction(browserParts, part) : undefined"
        :label="getToolName(part) === 'browser' ? hostBefore(browserParts, browserParts.indexOf(part)) : undefined"
      />
      <UChatTool
        v-else-if="part.state === 'output-denied'"
        text="You declined this action. Nothing was changed."
        icon="i-lucide-ban"
      />
      <ChatToolBrowserStep
        v-else-if="getToolName(part) === 'browser'"
        :state="part.state"
        :input="part.input"
        :output="part.output"
        :controls="controlsBefore(browserParts, browserParts.indexOf(part))"
      />
      <ChatToolChart
        v-else-if="getToolName(part) === 'chart'"
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
        v-else-if="getToolName(part) === 'read_document'"
        :text="isToolStreaming(part) ? 'Reading the file...' : getDocumentRead(part).failed ? 'Could not read the file' : 'Read the file'"
        :suffix="getDocumentRead(part).file"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-file-text"
      />
      <UChatTool
        v-else-if="getToolName(part) === 'fetch_file'"
        :text="isToolStreaming(part) ? 'Saving the file...' : getFileTrace(part).failed ? 'Could not save the file' : 'Saved the file'"
        :suffix="[getFileTrace(part).name, getFileTrace(part).source].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-download"
        :chevron="getFileTrace(part).isImage || getFileTrace(part).error ? 'leading' : undefined"
      >
        <FileImage
          v-if="getFileTrace(part).isImage && getFileTrace(part).fileId"
          :file-id="getFileTrace(part).fileId!"
          :alt="getFileTrace(part).name"
          class="max-h-48 rounded-lg border border-default"
        />
        <p
          v-else-if="getFileTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getFileTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'view_image'"
        :text="isToolStreaming(part) ? 'Looking at the image...' : getFileTrace(part).failed ? 'Could not open the image' : 'Looked at the image'"
        :suffix="[getFileTrace(part).name, getFileTrace(part).source].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-eye"
        :chevron="getFileTrace(part).fileId || getFileTrace(part).error ? 'leading' : undefined"
      >
        <FileImage
          v-if="getFileTrace(part).fileId"
          :file-id="getFileTrace(part).fileId!"
          :alt="getFileTrace(part).name"
          class="max-h-48 rounded-lg border border-default"
        />
        <p
          v-else-if="getFileTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getFileTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'look_at_page'"
        :text="isToolStreaming(part) ? 'Looking at the page...' : getPageTrace(part).failed ? 'Could not open the page' : 'Looked at the page'"
        :suffix="getPageTrace(part).source || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-scan-eye"
        :chevron="getPageTrace(part).fileId || getPageTrace(part).error ? 'leading' : undefined"
      >
        <FileImage
          v-if="getPageTrace(part).fileId"
          :file-id="getPageTrace(part).fileId!"
          :alt="getPageTrace(part).title || getPageTrace(part).source"
          class="w-full max-w-xl rounded-lg border border-default"
        />
        <p
          v-else-if="getPageTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getPageTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'design_tokens'"
        :text="isToolStreaming(part) ? 'Reading the design...' : getPageTrace(part).failed ? 'Could not read the design' : 'Read the design'"
        :suffix="getPageTrace(part).source || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-palette"
        :chevron="getPageTrace(part).colors.length || getPageTrace(part).error ? 'leading' : undefined"
      >
        <div
          v-if="getPageTrace(part).colors.length"
          class="flex flex-col gap-2"
        >
          <div class="flex flex-wrap gap-2">
            <span
              v-for="c in getPageTrace(part).colors"
              :key="c.hex"
              class="inline-flex items-center gap-1.5 rounded-full border border-default py-0.5 pr-2 pl-1 text-xs text-muted"
            >
              <span
                class="size-4 rounded-full border border-default"
                :style="{ backgroundColor: c.hex }"
              />
              {{ c.hex }}
            </span>
          </div>
          <p
            v-if="getPageTrace(part).fonts.length"
            class="text-sm text-muted"
          >
            {{ getPageTrace(part).fonts.join(' · ') }}
          </p>
        </div>
        <p
          v-else-if="getPageTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getPageTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'find_icons'"
        :text="isToolStreaming(part) ? 'Looking for icons...' : getLookupTrace(part).failed ? 'Could not search icons' : 'Found icons'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-shapes"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'find_fonts'"
        :text="isToolStreaming(part) ? 'Looking for fonts...' : getLookupTrace(part).failed ? 'Could not search fonts' : 'Found fonts'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-type"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'find_photos'"
        :text="isToolStreaming(part) ? 'Looking for photos...' : getLookupTrace(part).failed ? 'Could not search photos' : 'Found photos'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-image"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'github_read'"
        :text="isToolStreaming(part) ? 'Reading the project...' : getLookupTrace(part).failed ? 'Could not read the project' : 'Read the project'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-github"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'community_search'"
        :text="isToolStreaming(part) ? 'Searching the Reef...' : getLookupTrace(part).failed ? 'Could not search the Reef' : 'Searched the Reef'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-waves"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'run_on_computer' || getToolName(part) === 'run_in_cloud'"
        :text="isToolStreaming(part) ? (getToolName(part) === 'run_in_cloud' ? 'Running the plan in the cloud...' : 'Running the plan on your computer...') : getRunTrace(part).failed ? 'Could not run the plan' : getRunTrace(part).stopped ? 'The plan stopped on a step' : getRunTrace(part).steps.length === 1 ? `Ran 1 step ${getToolName(part) === 'run_in_cloud' ? 'in the cloud' : 'on your computer'}` : `Ran ${getRunTrace(part).steps.length} steps ${getToolName(part) === 'run_in_cloud' ? 'in the cloud' : 'on your computer'}`"
        :suffix="getRunTrace(part).summary"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-terminal"
        :chevron="getRunTrace(part).steps.length || getRunTrace(part).error ? 'leading' : undefined"
      >
        <div
          v-if="getRunTrace(part).steps.length"
          class="flex flex-col gap-1.5 text-sm"
        >
          <div
            v-for="step in getRunTrace(part).steps"
            :key="step.n"
            class="flex flex-col gap-1"
          >
            <p class="flex items-baseline gap-2 min-w-0">
              <UIcon
                name="i-lucide-terminal"
                :class="['size-3.5 shrink-0 self-center', step.ok ? 'text-muted' : 'text-error']"
              />
              <span :class="step.ok ? 'text-muted' : 'text-error'">{{ step.ok ? 'Ran' : step.timedOut ? 'Timed out' : 'Failed' }}</span>
              <code class="font-mono text-[13px] text-default break-all">{{ step.command }}</code>
            </p>
            <details
              v-if="step.output"
              class="ml-6 text-xs text-muted"
              :open="!step.ok"
            >
              <summary class="cursor-pointer select-none">
                {{ step.ok ? 'What it printed' : 'What went wrong' }}
              </summary>
              <pre class="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-elevated/50 border border-default px-2.5 py-2 font-mono">{{ step.output }}</pre>
            </details>
          </div>
          <p
            v-if="getRunTrace(part).notRun"
            class="ml-6 text-xs text-muted"
          >
            Not run: {{ getRunTrace(part).notRun }} more {{ getRunTrace(part).notRun === 1 ? 'step' : 'steps' }}
          </p>
        </div>
        <p
          v-else-if="getRunTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getRunTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'look_in_folder' || getToolName(part) === 'add_tool_server' || getToolName(part) === 'install_skill'"
        :text="isToolStreaming(part) ? (getToolName(part) === 'add_tool_server' ? 'Adding the tool server...' : getToolName(part) === 'install_skill' ? 'Keeping the skill...' : 'Looking in your folder...') : getRowsTrace(part).failed ? (getToolName(part) !== 'look_in_folder' ? getRowsTrace(part).title : 'Could not look in the folder') : getRowsTrace(part).title"
        :suffix="getRowsTrace(part).summary"
        :streaming="isToolStreaming(part)"
        :icon="getToolName(part) === 'add_tool_server' ? 'i-lucide-plug' : getToolName(part) === 'install_skill' ? 'i-lucide-book-open-text' : 'i-lucide-folder-search'"
        :chevron="getRowsTrace(part).rows.length || getRowsTrace(part).error ? 'leading' : undefined"
      >
        <div
          v-if="getRowsTrace(part).rows.length"
          class="flex flex-col gap-1 text-sm"
        >
          <p
            v-for="row in getRowsTrace(part).rows"
            :key="row.verb + row.name"
            :class="['flex items-baseline gap-2 min-w-0', row.verb ? '' : 'ml-4']"
          >
            <span
              v-if="row.verb"
              class="text-muted shrink-0"
            >{{ row.verb }}</span>
            <span
              v-if="row.name === 'your folder' || (row as { plain?: boolean }).plain"
              class="text-default"
            >{{ row.name }}</span>
            <code
              v-else-if="row.name"
              :class="['font-mono text-[13px] break-all', row.verb ? 'text-default' : 'text-muted']"
            >{{ row.name }}</code>
          </p>
        </div>
        <p
          v-if="getRowsTrace(part).error"
          class="text-sm text-muted"
          :class="getRowsTrace(part).rows.length ? 'mt-1' : ''"
        >
          {{ getRowsTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'check_setup'"
        :text="isToolStreaming(part) ? 'Checking what is connected...' : getLookupTrace(part).failed ? 'Could not check' : 'Checked what is connected'"
        :suffix="getLookupTrace(part).summary"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-plug-zap"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'find_skill'"
        :text="isToolStreaming(part) ? 'Looking for a skill...' : getLookupTrace(part).failed ? 'Could not search for skills' : 'Searched for skills'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-compass"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'load_external_skill'"
        :text="isToolStreaming(part) ? 'Opening the skill...' : getLookupTrace(part).failed ? 'Could not load the skill' : 'Loaded the skill'"
        :suffix="[getLookupTrace(part).query, getLookupTrace(part).count !== undefined ? `${getLookupTrace(part).count} found` : undefined].filter(Boolean).join(' · ') || undefined"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-book-open-text"
        :chevron="getLookupTrace(part).lines.length || getLookupTrace(part).error ? 'leading' : undefined"
      >
        <ul
          v-if="getLookupTrace(part).lines.length"
          class="flex flex-col gap-0.5 text-sm text-muted"
        >
          <li
            v-for="line in getLookupTrace(part).lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <p
          v-else-if="getLookupTrace(part).error"
          class="text-sm text-muted"
        >
          {{ getLookupTrace(part).error }}
        </p>
      </UChatTool>
      <UChatTool
        v-else-if="getToolName(part) === 'load_skill'"
        :text="isToolStreaming(part) ? 'Opening a skill...' : getSkillName(part) ? 'Used the skill' : 'Skill unavailable'"
        :suffix="getSkillName(part)"
        :streaming="isToolStreaming(part)"
        icon="i-lucide-book-open-text"
      />
      <UChatTool
        v-else-if="getToolName(part) === 'web_fetch'"
        :text="isToolStreaming(part) ? 'Reading the page...' : getFetchedPage(part).failed ? 'Could not read the page' : 'Read the page'"
        :suffix="getFetchedPage(part).url"
        :streaming="isToolStreaming(part)"
        chevron="leading"
      >
        <ChatToolSources :sources="getFetchedPage(part).source ? [getFetchedPage(part).source!] : []" />
      </UChatTool>
      <ChatToolAgentProposal
        v-else-if="getToolName(part) === 'propose_agent'"
        :invocation="part"
      />
      <ChatToolMemory
        v-else-if="['remember', 'forget_memory'].includes(getToolName(part))"
        :part="part"
      />
      <ChatToolFile
        v-else-if="['create_document', 'create_spreadsheet', 'create_presentation', 'create_page'].includes(getToolName(part))"
        :invocation="part"
      />
      <ChatToolEditFile
        v-else-if="getToolName(part) === 'edit_file'"
        :invocation="part"
      />
      <ChatToolProjectFile
        v-else-if="['list_files', 'read_file', 'search_files', 'write_file', 'edit_project_file', 'delete_file'].includes(getToolName(part))"
        :invocation="part"
      />
      <ChatToolTaskProposal
        v-else-if="getToolName(part) === 'task_propose'"
        :invocation="part"
      />
      <ChatToolInspection
        v-else-if="getToolName(part) === 'inspect_design'"
        :invocation="part"
      />
      <ChatToolComputerExcel
        v-else-if="getToolName(part) === 'computer_excel'"
        :invocation="part"
      />
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
        :value="withoutSourceMarks(part.text)"
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
