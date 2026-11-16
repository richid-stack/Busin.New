<script setup lang="ts">
import { computed } from 'vue'
import { getToolName } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useWorkPane } from '../../../composables/useWorkPane'

/** One step of building a project: reading, searching, writing, changing or removing a file. Same trace line as every other tool. */
const props = defineProps<{ invocation: any }>()

const name = computed(() => getToolName(props.invocation) as 'list_files' | 'read_file' | 'search_files' | 'write_file' | 'edit_project_file' | 'delete_file')
const streaming = computed(() => isToolStreaming(props.invocation))
const out = computed(() => (props.invocation.output && typeof props.invocation.output === 'object' ? props.invocation.output as Record<string, any> : null))
const failed = computed(() => !streaming.value && out.value?.status !== 'ok')
const input = computed<Record<string, any>>(() => (props.invocation.input && typeof props.invocation.input === 'object' ? props.invocation.input : {}))
const path = computed<string | undefined>(() => out.value?.path ?? input.value.path)
const pane = useWorkPane()
const isOpen = computed(() => !!out.value?.artifactId && pane.openId.value === out.value.artifactId)

const WORDS = {
  list_files: { icon: 'i-lucide-folder-tree', doing: 'Listing files', done: 'Listed files', fail: 'Could not list the files' },
  read_file: { icon: 'i-lucide-file-text', doing: 'Reading', done: 'Read', fail: 'Could not read' },
  search_files: { icon: 'i-lucide-search', doing: 'Searching', done: 'Searched', fail: 'Could not search' },
  write_file: { icon: 'i-lucide-file-plus', doing: 'Writing', done: 'Created', fail: 'Could not save' },
  edit_project_file: { icon: 'i-lucide-pencil-line', doing: 'Editing', done: 'Edited', fail: 'Could not edit' },
  delete_file: { icon: 'i-lucide-trash-2', doing: 'Removing', done: 'Removed', fail: 'Could not remove' }
} as const

const words = computed(() => WORDS[name.value] ?? WORDS.read_file)
const text = computed(() => {
  const w = words.value
  if (streaming.value) return `${w.doing}...`
  if (failed.value) return w.fail
  if (name.value === 'write_file' && out.value?.created === false) return 'Rewrote'
  return w.done
})
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const changes = computed(() => (out.value && (out.value.added || out.value.removed) ? `+${out.value.added ?? 0} −${out.value.removed ?? 0}` : ''))
const suffix = computed(() => {
  const n = name.value
  if (n === 'list_files') return out.value?.count !== undefined ? plural(out.value.count, 'file', 'files') : (input.value.folder || undefined)
  if (n === 'search_files') {
    const q = input.value.query ? `“${String(input.value.query).slice(0, 40)}”` : ''
    return out.value && !failed.value ? `${q} · ${plural(out.value.count ?? 0, 'match', 'matches')}` : q || undefined
  }
  if (n === 'write_file' || n === 'edit_project_file') return [path.value, changes.value].filter(Boolean).join(' · ') || undefined
  return path.value || undefined
})

const SHOWN = 8
const listed = computed<Array<{ path: string, lines: number }>>(() => (name.value === 'list_files' ? out.value?.files ?? [] : []))
const found = computed<Array<{ path: string, line: number, text: string }>>(() => (name.value === 'search_files' ? out.value?.matches ?? [] : []))
const canOpen = computed(() => ['write_file', 'edit_project_file', 'delete_file'].includes(name.value) && !!out.value?.artifactId && !isOpen.value)
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :streaming="streaming"
    :icon="words.icon"
    chevron="leading"
  >
    <p
      v-if="failed"
      class="text-sm text-muted"
    >
      {{ out?.error || 'That step did not work.' }}
    </p>
    <template v-else-if="out">
      <template v-if="name === 'list_files'">
        <p
          v-for="f in listed.slice(0, SHOWN)"
          :key="f.path"
          class="text-sm text-muted"
        >
          File · <span class="text-default">{{ f.path }}</span> · {{ plural(f.lines, 'line', 'lines') }}
        </p>
        <p
          v-if="listed.length > SHOWN"
          class="text-sm text-muted"
        >
          and {{ listed.length - SHOWN }} more
        </p>
        <p
          v-if="!listed.length"
          class="text-sm text-muted"
        >
          No files yet
        </p>
      </template>
      <template v-else-if="name === 'read_file'">
        <p class="text-sm text-muted">
          File · <span class="text-default">{{ out.path }}</span>
        </p>
        <p class="text-sm text-muted">
          Lines · <span class="text-default">{{ out.fromLine }} to {{ out.toLine }} of {{ out.totalLines }}</span>
        </p>
      </template>
      <template v-else-if="name === 'search_files'">
        <p
          v-for="m in found.slice(0, SHOWN)"
          :key="`${m.path}:${m.line}`"
          class="text-sm text-muted"
        >
          {{ m.path }}:{{ m.line }} · <span class="text-default">{{ m.text.slice(0, 80) }}</span>
        </p>
        <p
          v-if="out.count > SHOWN"
          class="text-sm text-muted"
        >
          and {{ out.count - SHOWN }} more
        </p>
        <p
          v-if="!out.count"
          class="text-sm text-muted"
        >
          Nothing found
        </p>
      </template>
      <template v-else>
        <p class="text-sm text-muted">
          File · <span class="text-default">{{ out.path }}</span>
        </p>
        <p
          v-if="name === 'edit_project_file'"
          class="text-sm text-muted"
        >
          Change · <span class="text-default">{{ plural(out.edits ?? 1, 'edit', 'edits') }}<template v-if="changes"> · {{ changes }}</template></span>
        </p>
        <p
          v-else-if="name === 'write_file'"
          class="text-sm text-muted"
        >
          Lines · <span class="text-default">{{ out.lines }}<template v-if="changes"> · {{ changes }}</template></span>
        </p>
        <p class="text-sm text-muted">
          Version · <span class="text-default">{{ out.version }}</span>
        </p>
        <UButton
          v-if="canOpen"
          label="Open the project"
          icon="i-lucide-panel-right-open"
          color="neutral"
          variant="link"
          size="xs"
          class="px-0"
          @click="pane.open(out.artifactId)"
        />
      </template>
    </template>
  </UChatTool>
</template>
