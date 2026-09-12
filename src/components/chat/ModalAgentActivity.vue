<script setup lang="ts">
import { ref, computed } from 'vue'
import type { UIMessage } from 'ai'
import { isReasoningUIPart, isToolUIPart, isTextUIPart, getToolName } from 'ai'
import { getSources, getSearchQuery } from '../../utils/tool'
import { getFaviconUrl, getDomain } from '../../utils/url'

const props = defineProps<{
  message: UIMessage
}>()

const emit = defineEmits<{ close: [boolean] }>()

const parts = computed(() => props.message.parts || [])

const reasoningParts = computed(() => parts.value.filter(isReasoningUIPart))
const toolParts = computed(() => parts.value.filter(isToolUIPart))

const totalSources = computed(() => {
  let count = 0
  for (const part of toolParts.value) {
    count += getSources(part).length
  }
  return count
})

const expandedDetails = ref<Record<number, boolean>>({})

function toggleDetails(index: number) {
  expandedDetails.value[index] = !expandedDetails.value[index]
}
</script>

<template>
  <UModal
    title="Agent Activity & Timeline"
    description="Inspection of execution steps, reasoning, and tools used."
    :ui="{
      content: 'sm:max-w-xl',
      footer: 'justify-end'
    }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- Summary Stat Badges -->
        <div class="grid grid-cols-3 gap-2 p-2.5 bg-elevated/40 rounded-lg border border-default text-center">
          <div class="flex flex-col">
            <span class="text-xs text-muted">Reasoning</span>
            <span class="text-sm font-semibold text-highlighted">
              {{ reasoningParts.length ? '1 session' : 'None' }}
            </span>
          </div>
          <div class="flex flex-col border-x border-default/60">
            <span class="text-xs text-muted">Tools executed</span>
            <span class="text-sm font-semibold text-highlighted">
              {{ toolParts.length }}
            </span>
          </div>
          <div class="flex flex-col">
            <span class="text-xs text-muted">Sources</span>
            <span class="text-sm font-semibold text-highlighted">
              {{ totalSources }}
            </span>
          </div>
        </div>

        <!-- Sequential Execution Timeline -->
        <div class="flex flex-col gap-3">
          <h4 class="text-xs font-semibold text-muted tracking-wider uppercase">
            Execution Steps
          </h4>

          <div class="flex flex-col divide-y divide-default/50 border border-default rounded-lg overflow-hidden bg-default">
            <template
              v-for="(part, idx) in parts"
              :key="idx"
            >
              <!-- Reasoning Phase -->
              <div
                v-if="isReasoningUIPart(part)"
                class="p-3 flex flex-col gap-1.5"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="size-6 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                      <UIcon
                        name="i-lucide-brain"
                        class="size-3.5"
                      />
                    </div>
                    <span class="text-sm font-medium text-highlighted">Reasoning & Formulation</span>
                  </div>
                  <UBadge
                    color="primary"
                    variant="subtle"
                    size="xs"
                  >
                    Completed
                  </UBadge>
                </div>
                <p class="text-xs text-muted leading-relaxed line-clamp-2 pl-8">
                  {{ part.text }}
                </p>
                <div class="pl-8 pt-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="link"
                    :label="expandedDetails[idx] ? 'Hide thinking' : 'Read thinking'"
                    :icon="expandedDetails[idx] ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    @click="toggleDetails(idx)"
                  />
                  <div
                    v-if="expandedDetails[idx]"
                    class="mt-2 p-2.5 bg-muted/20 border border-default rounded text-xs text-muted font-mono whitespace-pre-wrap max-h-48 overflow-y-auto"
                  >
                    {{ part.text }}
                  </div>
                </div>
              </div>

              <!-- Tool Execution Phase -->
              <div
                v-else-if="isToolUIPart(part)"
                class="p-3 flex flex-col gap-1.5"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="size-6 rounded-md bg-accented/50 flex items-center justify-center text-highlighted">
                      <UIcon
                        v-if="getToolName(part) === 'plan'"
                        name="i-lucide-list-checks"
                        class="size-3.5 text-success"
                      />
                      <UIcon
                        v-else-if="getToolName(part) === 'calculator'"
                        name="i-lucide-calculator"
                        class="size-3.5 text-warning"
                      />
                      <UIcon
                        v-else-if="getToolName(part) === 'web_search' || getToolName(part) === 'google_search'"
                        name="i-lucide-globe"
                        class="size-3.5 text-info"
                      />
                      <UIcon
                        v-else-if="getToolName(part) === 'chart'"
                        name="i-lucide-chart-column"
                        class="size-3.5 text-primary"
                      />
                      <UIcon
                        v-else
                        name="i-lucide-wrench"
                        class="size-3.5"
                      />
                    </div>
                    <span class="text-sm font-medium text-highlighted capitalize">
                      {{ getToolName(part).replace(/_/g, ' ') }}
                    </span>
                  </div>
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    Tool Call
                  </UBadge>
                </div>

                <!-- Web Search Info -->
                <div
                  v-if="getToolName(part) === 'web_search' || getToolName(part) === 'google_search'"
                  class="pl-8 flex flex-col gap-1 text-xs text-muted"
                >
                  <span>Query: <strong class="text-default font-normal">"{{ getSearchQuery(part) }}"</strong></span>
                  <div
                    v-if="getSources(part).length"
                    class="flex flex-wrap gap-1 mt-1"
                  >
                    <a
                      v-for="src in getSources(part).slice(0, 4)"
                      :key="src.url"
                      :href="src.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-elevated border border-default text-[11px] text-default hover:text-highlighted"
                    >
                      <img
                        :src="getFaviconUrl(src.url)"
                        class="size-3 rounded-sm"
                      >
                      <span>{{ getDomain(src.url) }}</span>
                    </a>
                  </div>
                </div>

                <!-- Generic or specific tool toggle -->
                <div class="pl-8 pt-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="link"
                    :label="expandedDetails[idx] ? 'Hide parameters' : 'Inspect payload'"
                    :icon="expandedDetails[idx] ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    @click="toggleDetails(idx)"
                  />
                  <div
                    v-if="expandedDetails[idx]"
                    class="mt-2 p-2.5 bg-muted/20 border border-default rounded text-xs text-muted font-mono whitespace-pre-wrap max-h-48 overflow-y-auto"
                  >
                    <div class="font-semibold text-default mb-1">
                      Input:
                    </div>
                    <pre>{{ JSON.stringify(part.input, null, 2) }}</pre>
                    <div
                      v-if="part.output"
                      class="font-semibold text-default mt-2 mb-1"
                    >
                      Output:
                    </div>
                    <pre v-if="part.output">{{ JSON.stringify(part.output, null, 2) }}</pre>
                  </div>
                </div>
              </div>

              <!-- Final Text Synthesis Phase -->
              <div
                v-else-if="isTextUIPart(part) && idx === parts.length - 1"
                class="p-3 flex items-center justify-between"
              >
                <div class="flex items-center gap-2">
                  <div class="size-6 rounded-md bg-success/10 flex items-center justify-center text-success">
                    <UIcon
                      name="i-lucide-check"
                      class="size-3.5"
                    />
                  </div>
                  <span class="text-sm font-medium text-highlighted">Response Synthesized</span>
                </div>
                <UBadge
                  color="success"
                  variant="subtle"
                  size="xs"
                >
                  Complete
                </UBadge>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        label="Done"
        @click="emit('close', true)"
      />
    </template>
  </UModal>
</template>
