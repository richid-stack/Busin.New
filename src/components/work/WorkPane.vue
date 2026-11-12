<script setup lang="ts">
import { computed, watch } from 'vue'
import { useWorkPane } from '../../composables/useWorkPane'
import { changeMessage, partLabel } from '../../utils/workLabel'
import type { DocumentContent, PageContent, PresentationContent, ProjectContent, WorkbookContent } from '../../types/artifacts'
import DocumentView from './DocumentView.vue'
import SheetView from './SheetView.vue'
import SlidesView from './SlidesView.vue'
import PageView from './PageView.vue'
import ProjectView from './ProjectView.vue'

const props = defineProps<{ busy: boolean }>()
/** The pane asks the chat to make the change, so it shows up as a normal message and the assistant uses its edit tool. */
const emit = defineEmits<{ send: [text: string] }>()

const pane = useWorkPane()
const { file, loading, error, selection, sheet } = pane

const ICON = { document: 'i-lucide-file-text', workbook: 'i-lucide-file-spreadsheet', presentation: 'i-lucide-presentation', page: 'i-lucide-globe', project: 'i-lucide-folder-code' } as const
const NAME = { document: 'Word document', workbook: 'Excel spreadsheet', presentation: 'PowerPoint presentation', page: 'Web page', project: 'Project' } as const

// A slide deck always has a current slide and a web page is one whole part, so the Change box always means something.
watch([file, selection], () => {
  if ((file.value?.kind === 'presentation' || file.value?.kind === 'page') && !selection.value) pane.select({ from: 1, to: 1 })
}, { immediate: true })

const label = computed(() => (file.value && selection.value ? partLabel(file.value, selection.value) : ''))
const stuck = computed(() => props.busy || pane.busy.value)
const isProject = computed(() => file.value?.kind === 'project')
const fileCount = computed(() => (isProject.value ? (file.value!.spec as ProjectContent).files.length : 0))
// A project comes as a .zip with every file, or as one web page with the styles and scripts inside.
const downloads = computed(() => [[
  { label: 'Project (.zip)', description: 'All the files, ready to open or upload', icon: 'i-lucide-folder-code', onSelect: () => pane.download() },
  { label: 'Single page (.html)', description: 'One file with the styles and scripts inside', icon: 'i-lucide-file-code', onSelect: () => pane.download('html') }
]])

function change(request: string) {
  if (!file.value || !selection.value || props.busy) return
  emit('send', changeMessage(label.value, request))
}
function select(sel: typeof selection.value) { pane.select(sel) }
function pickSheet(n: number) { sheet.value = n; pane.select(null) }
</script>

<template>
  <aside
    class="flex flex-col min-w-0 h-full border-l border-default bg-default"
    aria-label="Open file"
  >
    <header class="flex items-center gap-2 px-4 h-14 border-b border-default shrink-0">
      <div class="size-8 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center shrink-0">
        <UIcon
          :name="file ? ICON[file.kind] : 'i-lucide-file'"
          class="size-4 text-primary"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-highlighted truncate">
          <template v-if="file && isProject">
            {{ file.title }}<span class="ms-1.5 text-xs font-normal text-muted">{{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }}</span>
          </template>
          <template v-else>
            {{ file ? `${file.title}.${file.format}` : 'Opening file' }}
          </template>
        </p>
      </div>
      <div
        v-if="file"
        class="flex items-center gap-0.5 rounded-lg border border-default p-0.5 shrink-0"
      >
        <UButton
          icon="i-lucide-undo-2"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Undo"
          :disabled="!file.canUndo || stuck"
          @click="pane.move(file.head - 1)"
        />
        <span class="text-xs text-muted px-1.5 tabular-nums">v{{ file.head }} of {{ file.latest }}</span>
        <UButton
          icon="i-lucide-redo-2"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Redo"
          :disabled="!file.canRedo || stuck"
          @click="pane.move(file.head + 1)"
        />
      </div>
      <UDropdownMenu
        v-if="file && isProject"
        :items="downloads"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-download"
          label="Download"
          trailing-icon="i-lucide-chevron-down"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
          :loading="pane.downloading.value"
        />
      </UDropdownMenu>
      <UButton
        v-else-if="file"
        icon="i-lucide-download"
        label="Download"
        color="neutral"
        variant="subtle"
        size="sm"
        class="shrink-0"
        :loading="pane.downloading.value"
        @click="pane.download()"
      />
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Close"
        class="shrink-0"
        @click="pane.close()"
      />
    </header>

    <div
      class="flex-1 min-h-0 bg-elevated/40"
      :class="isProject ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-4 sm:p-6'"
      @click="select(null)"
    >
      <p
        v-if="error"
        role="alert"
        class="mx-auto max-w-[560px] mb-4 rounded-lg border border-default bg-default px-3 py-2 text-sm text-default"
      >
        {{ error }}
      </p>
      <div
        v-if="loading && !file"
        class="mx-auto max-w-[560px] flex flex-col gap-3"
        aria-busy="true"
      >
        <USkeleton class="h-6 w-2/3" /><USkeleton class="h-4 w-full" /><USkeleton class="h-4 w-5/6" /><USkeleton class="h-4 w-full" />
      </div>
      <template v-else-if="file">
        <p class="sr-only">
          {{ NAME[file.kind] }}
        </p>
        <DocumentView
          v-if="file.kind === 'document'"
          :spec="(file.spec as DocumentContent)"
          :selection="selection"
          :busy="stuck"
          :label="label"
          @select="select"
          @change="change"
        />
        <SheetView
          v-else-if="file.kind === 'workbook'"
          :spec="(file.spec as WorkbookContent)"
          :sheet="sheet"
          :selection="selection"
          :busy="stuck"
          :label="label"
          @select="select"
          @sheet="pickSheet"
          @change="change"
        />
        <ProjectView
          v-else-if="file.kind === 'project'"
          :file="file"
          :spec="(file.spec as ProjectContent)"
        />
        <PageView
          v-else-if="file.kind === 'page'"
          :spec="(file.spec as PageContent)"
          :busy="stuck"
          :label="label"
          @change="change"
        />
        <SlidesView
          v-else
          :spec="(file.spec as PresentationContent)"
          :selection="selection"
          :busy="stuck"
          :label="label"
          @select="select"
          @change="change"
        />
      </template>
    </div>
  </aside>
</template>
