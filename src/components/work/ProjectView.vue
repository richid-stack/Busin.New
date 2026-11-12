<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ArtifactView, ProjectContent } from '../../types/artifacts'
import { diffLines, splitLines } from '../../../shared/lineDiff'
import type { DiffLine } from '../../../shared/lineDiff'
import { pageProblem } from '../../../shared/pageHtml'
import { bundleProject, projectEntry } from '../../../shared/project'
import { previewDocument } from '../../utils/pagePreview'

const props = defineProps<{ file: ArtifactView, spec: ProjectContent }>()

/** Show at most this many lines of one file. The whole file is still in the project and in the download. */
const SHOWN_LINES = 2000

const files = computed(() => [...props.spec.files].sort((a, b) => a.path.localeCompare(b.path, 'en')))

// What changed in the version being shown: the version before it is fetched and compared file by file.
const previous = ref<Map<string, string> | null>(null)
let seq = 0
watch(() => [props.file.id, props.file.head, props.file.canUndo] as const, async ([id, head, canUndo]) => {
  const mine = ++seq
  if (!canUndo) { previous.value = null; return }
  try {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}?version=${head - 1}`, { headers: { Accept: 'application/json' } })
    if (mine !== seq) return
    if (!res.ok) { previous.value = null; return }
    const body = await res.json() as { spec: ProjectContent }
    if (mine === seq) previous.value = new Map(body.spec.files.map(f => [f.path, f.content]))
  } catch {
    if (mine === seq) previous.value = null
  }
}, { immediate: true })

const state = computed(() => {
  const out = new Map<string, 'new' | 'changed'>()
  const before = previous.value
  if (!before) return out
  for (const f of files.value) {
    if (!before.has(f.path)) out.set(f.path, 'new')
    else if (before.get(f.path) !== f.content) out.set(f.path, 'changed')
  }
  return out
})

// Which file is open. Until the person picks one, the pane follows the work: the first file that changed.
const picked = ref<string | null>(null)
const followed = ref<string | null>(null)
watch(() => props.file.id, () => { picked.value = null; followed.value = null })
watch([files, state], () => {
  if (picked.value && files.value.some(f => f.path === picked.value)) return
  picked.value = null
  followed.value = [...state.value.keys()][0] ?? projectEntry(files.value) ?? files.value[0]?.path ?? null
}, { immediate: true })
const selectedPath = computed(() => picked.value ?? followed.value)
const current = computed(() => files.value.find(f => f.path === selectedPath.value) ?? null)

// The file list, as folders you can fold.
const closed = ref(new Set<string>())
const rows = computed(() => {
  const out: { kind: 'dir' | 'file', name: string, path: string, depth: number }[] = []
  const seen = new Set<string>()
  for (const f of files.value) {
    const parts = f.path.split('/')
    let hidden = false
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/')
      if (!seen.has(dir)) { seen.add(dir); if (!hidden) out.push({ kind: 'dir', name: parts[i]!, path: dir, depth: i }) }
      if (closed.value.has(dir)) hidden = true
    }
    if (!hidden) out.push({ kind: 'file', name: parts[parts.length - 1]!, path: f.path, depth: parts.length - 1 })
  }
  return out
})
function fold(dir: string) {
  const next = new Set(closed.value)
  if (!next.delete(dir)) next.add(dir)
  closed.value = next
}

const mode = ref<'code' | 'preview'>('code')
const hasPage = computed(() => !!projectEntry(files.value))

/** The lines to show for the open file: with what changed marked, or plain. */
const view = computed<{ lines: DiffLine[], note: string, added: number, removed: number, tag: string }>(() => {
  const file = current.value
  if (!file) return { lines: [], note: '', added: 0, removed: 0, tag: '' }
  const status = state.value.get(file.path)
  const before = previous.value?.get(file.path)
  let lines: DiffLine[]
  let added = 0
  let removed = 0
  if (status === 'changed' && before !== undefined) {
    const d = diffLines(before, file.content)
    lines = d.lines; added = d.added; removed = d.removed
  } else {
    lines = splitLines(file.content).map((text, i) => ({ kind: status === 'new' ? 'add' as const : 'same' as const, text, newNo: i + 1 }))
    if (status === 'new') added = lines.length
  }
  const note = lines.length > SHOWN_LINES ? `Showing the first ${SHOWN_LINES.toLocaleString('en')} of ${lines.length.toLocaleString('en')} lines. The whole file is in the project and the download.` : ''
  const tag = status === 'new' ? `New in v${props.file.head}` : status === 'changed' ? `Changed in v${props.file.head}` : ''
  return { lines: lines.slice(0, SHOWN_LINES), note, added, removed, tag }
})

const preview = computed<{ doc: string } | { problem: string }>(() => {
  if (mode.value !== 'preview') return { problem: '' }
  const page = bundleProject(files.value)
  if ('problem' in page) return { problem: page.problem }
  const problem = pageProblem(page.html)
  if (problem) return { problem: `The preview cannot show this page. ${problem}` }
  return { doc: previewDocument(page.html, props.spec.title) }
})

const mark = { add: '+', del: '−', same: '' } as const
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col sm:grid sm:grid-cols-[172px_minmax(0,1fr)] bg-elevated/40">
    <label class="sm:hidden p-3 border-b border-default bg-default">
      <span class="sr-only">File</span>
      <select
        class="w-full rounded-md border border-default bg-default px-2 py-1.5 text-sm text-highlighted"
        :value="selectedPath ?? ''"
        @change="picked = ($event.target as HTMLSelectElement).value"
      >
        <option
          v-for="f in files"
          :key="f.path"
          :value="f.path"
        >{{ f.path }}</option>
      </select>
    </label>

    <nav
      class="hidden sm:flex flex-col gap-px border-e border-default p-2 overflow-y-auto min-h-0"
      aria-label="Project files"
    >
      <p class="px-2 pt-2 pb-2 text-[11px] tracking-wide text-dimmed uppercase">
        Project
      </p>
      <p
        v-if="!rows.length"
        class="px-2 text-sm text-muted"
      >
        No files yet.
      </p>
      <template
        v-for="r in rows"
        :key="r.path"
      >
        <button
          v-if="r.kind === 'dir'"
          type="button"
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-highlighted hover:bg-elevated/60 text-left"
          :style="{ paddingInlineStart: `${8 + r.depth * 16}px` }"
          :aria-expanded="!closed.has(r.path)"
          @click="fold(r.path)"
        >
          <UIcon
            :name="closed.has(r.path) ? 'i-lucide-folder' : 'i-lucide-folder-open'"
            class="size-4 shrink-0"
          />
          <span class="truncate">{{ r.name }}</span>
        </button>
        <button
          v-else
          type="button"
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-left"
          :class="selectedPath === r.path ? 'bg-elevated text-highlighted' : 'text-muted hover:text-highlighted hover:bg-elevated/60'"
          :style="{ paddingInlineStart: `${8 + r.depth * 16}px` }"
          :aria-current="selectedPath === r.path ? 'true' : undefined"
          @click="picked = r.path"
        >
          <UIcon
            name="i-lucide-file-code"
            class="size-4 shrink-0"
          />
          <span class="truncate">{{ r.name }}</span>
          <span
            v-if="state.get(r.path)"
            class="ms-auto size-1.5 rounded-full bg-primary shrink-0"
            :title="state.get(r.path) === 'new' ? 'New' : 'Changed'"
          />
        </button>
      </template>
    </nav>

    <section class="flex flex-col min-w-0 min-h-0 bg-default sm:bg-transparent">
      <div class="flex items-center gap-3 px-4 h-11 border-b border-default shrink-0 text-sm">
        <span class="text-highlighted truncate">{{ current?.path ?? 'No file open' }}</span>
        <div
          v-if="hasPage"
          class="flex items-center gap-0.5 rounded-lg border border-default p-0.5 text-xs shrink-0"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'code'"
            class="rounded-md px-2.5 py-1"
            :class="mode === 'code' ? 'bg-accented text-highlighted' : 'text-muted'"
            @click="mode = 'code'"
          >
            Code
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'preview'"
            class="rounded-md px-2.5 py-1"
            :class="mode === 'preview' ? 'bg-accented text-highlighted' : 'text-muted'"
            @click="mode = 'preview'"
          >
            Preview
          </button>
        </div>
        <template v-if="mode === 'code'">
          <span
            v-if="view.tag"
            class="text-[11px] text-primary rounded-full border border-primary/40 px-2 py-px shrink-0"
          >{{ view.tag }}</span>
          <span class="flex-1" />
          <span
            v-if="view.added || view.removed"
            class="text-xs text-muted tabular-nums shrink-0"
          >+{{ view.added }} −{{ view.removed }}</span>
        </template>
        <template v-else>
          <span class="flex-1" />
          <span class="text-xs text-muted shrink-0">Runs on its own</span>
        </template>
      </div>

      <div
        v-if="mode === 'code'"
        class="flex-1 min-h-0 overflow-auto py-3 font-mono text-[12.5px] leading-[1.75] text-default"
      >
        <p
          v-if="!current"
          class="px-4 text-sm text-muted font-sans"
        >
          Files appear here as the assistant builds the project.
        </p>
        <div class="min-w-max">
          <div
            v-for="(l, i) in view.lines"
            :key="i"
            class="grid grid-cols-[44px_18px_1fr] whitespace-pre"
            :class="l.kind === 'add' ? 'bg-success/15' : l.kind === 'del' ? 'bg-error/15' : ''"
          >
            <span class="text-dimmed text-right pe-3 select-none">{{ l.newNo ?? l.oldNo }}</span>
            <span
              class="select-none"
              :class="l.kind === 'add' ? 'text-success' : l.kind === 'del' ? 'text-error' : 'text-dimmed'"
            >{{ mark[l.kind] }}</span>
            <span class="pe-4">{{ l.text }}</span>
          </div>
        </div>
        <p
          v-if="view.note"
          class="px-4 pt-3 text-xs text-muted font-sans"
        >
          {{ view.note }}
        </p>
      </div>

      <div
        v-else
        class="flex-1 min-h-0 overflow-y-auto p-4"
      >
        <div class="mx-auto max-w-[760px]">
          <div class="rounded-xl border border-default bg-default shadow-md overflow-hidden">
            <div class="flex items-center gap-1.5 px-3 h-9 border-b border-default bg-elevated/70">
              <span class="size-2.5 rounded-full bg-accented" /><span class="size-2.5 rounded-full bg-accented" /><span class="size-2.5 rounded-full bg-accented" />
              <span class="ms-3 text-[11px] text-muted truncate rounded-md bg-default border border-default px-2 py-0.5 flex-1 max-w-xs">Preview · runs on its own, never touches OpenLobs</span>
            </div>
            <p
              v-if="'problem' in preview"
              class="p-6 text-sm text-muted"
            >
              {{ preview.problem }}
            </p>
            <iframe
              v-else
              :srcdoc="preview.doc"
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              :title="`Preview of ${spec.title}`"
              class="block w-full h-[62vh] min-h-[420px] bg-white"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
