<script setup lang="ts">
import { computed } from 'vue'
import type { PartSelection, WorkbookContent } from '../../types/artifacts'
import { cellText, columnLetter } from '../../utils/workFormat'
import ChangeBox from './ChangeBox.vue'

const props = defineProps<{ spec: WorkbookContent, sheet: number, selection: PartSelection | null, busy: boolean, label: string }>()
const emit = defineEmits<{ select: [sel: PartSelection | null], sheet: [n: number], change: [text: string] }>()

const current = computed(() => props.spec.sheets[props.sheet - 1] ?? props.spec.sheets[0]!)
const here = computed(() => !!props.selection && (props.selection.sheet ?? 1) === props.sheet)
const rowPicked = (r: number) => here.value && r + 1 >= props.selection!.from && r + 1 <= props.selection!.to
const cellPicked = (r: number, c: number) => rowPicked(r) && props.selection!.col === c + 1

function pick(r: number, c?: number) {
  const s = props.selection
  const same = here.value && s!.from === r + 1 && s!.to === r + 1 && s!.col === (c === undefined ? undefined : c + 1)
  emit('select', same ? null : { sheet: props.sheet, from: r + 1, to: r + 1, ...(c === undefined ? {} : { col: c + 1 }) })
}
const example = computed(() => {
  const sel = props.selection
  if (!sel?.col) return 'Ask for a change, e.g. “drop it by a tenth”'
  const cell = props.spec.sheets[props.sheet - 1]?.rows[sel.from - 1]?.[sel.col - 1]
  return typeof cell === 'number' ? 'Change this cell, e.g. “make it 5,000”' : 'Change this cell, e.g. “rename it”'
})
</script>

<template>
  <div
    class="mx-auto max-w-[640px]"
    @click="emit('select', null)"
  >
    <div class="rounded-xl border border-default bg-default shadow-sm overflow-auto max-h-[60vh] text-sm">
      <table class="w-full border-collapse">
        <thead class="bg-elevated/70 sticky top-0">
          <tr>
            <th class="w-9 border-b border-default" />
            <th
              v-for="(h, c) in current.header"
              :key="c"
              class="text-left font-medium text-muted px-3 py-2 border-b border-default whitespace-nowrap"
            >
              <span class="text-[10px] text-dimmed me-1">{{ columnLetter(c) }}</span>{{ h }}
            </th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="(row, r) in current.rows"
            :key="r"
          >
            <tr :class="rowPicked(r) ? 'bg-primary/5' : 'hover:bg-elevated/40'">
              <td
                class="text-xs text-dimmed text-center border-b border-default py-2 cursor-pointer select-none"
                @click.stop="pick(r)"
              >
                {{ r + 1 }}
              </td>
              <td
                v-for="(_, c) in current.header"
                :key="c"
                :class="['px-3 py-2 border-b border-default cursor-pointer whitespace-nowrap', cellText(row[c], current.formats?.[c], current).number ? 'tabular-nums text-right' : c === 0 ? 'font-medium text-highlighted' : '', cellText(row[c], current.formats?.[c], current).formula ? 'font-medium' : '', cellPicked(r, c) ? 'ring-2 ring-inset ring-primary/60' : '']"
                @click.stop="pick(r, c)"
              >
                {{ cellText(row[c], current.formats?.[c], current).text }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div
      v-if="here"
      class="mt-3"
    >
      <ChangeBox
        :placeholder="example"
        :busy="busy"
        :label="label"
        @change="emit('change', $event)"
      />
    </div>
    <p
      v-else
      class="mt-3 text-xs text-muted text-center"
    >
      Click a row or a cell to ask for a change.
    </p>
    <div
      v-if="spec.sheets.length > 1"
      class="mt-3 flex flex-wrap gap-1.5"
    >
      <button
        v-for="(s, i) in spec.sheets"
        :key="i"
        type="button"
        :class="['rounded-md px-2.5 py-1 text-xs transition-colors', i + 1 === sheet ? 'bg-default border border-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted']"
        @click.stop="emit('sheet', i + 1)"
      >
        {{ s.name }}
      </button>
    </div>
  </div>
</template>
