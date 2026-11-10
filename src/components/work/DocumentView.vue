<script setup lang="ts">
import { computed } from 'vue'
import type { DocumentContent, PartSelection } from '../../types/artifacts'
import { documentRange } from '../../utils/workLabel'
import ChangeBox from './ChangeBox.vue'

const props = defineProps<{ spec: DocumentContent, selection: PartSelection | null, busy: boolean, label: string }>()
const emit = defineEmits<{ select: [sel: PartSelection | null], change: [text: string] }>()

const picked = (i: number) => !!props.selection && i + 1 >= props.selection.from && i + 1 <= props.selection.to
/** The picked blocks form one group, so a heading and the text under it read as a single highlighted section. */
const groups = computed(() => {
  const out: { picked: boolean, items: number[] }[] = []
  props.spec.blocks.forEach((_, i) => {
    const on = picked(i)
    const last = out[out.length - 1]
    if (last && last.picked === on && on) last.items.push(i)
    else out.push({ picked: on, items: [i] })
  })
  return out
})
const pick = (i: number) => {
  const r = documentRange(props.spec.blocks, i)
  const same = props.selection && props.selection.from === r.from && props.selection.to === r.to
  emit('select', same ? null : r)
}
const example = computed(() => {
  const block = props.spec.blocks[(props.selection?.from ?? 1) - 1]
  return block?.type === 'table' ? 'Ask for a change, e.g. “add a row for tax”' : 'Ask for a change, e.g. “make it shorter”'
})
const sizes = ['text-xl', 'text-base', 'text-sm', 'text-sm']
</script>

<template>
  <article class="mx-auto max-w-[560px] rounded-lg bg-white text-neutral-900 shadow-md ring-1 ring-black/5 px-8 sm:px-12 py-10 text-[13px] leading-relaxed" @click="emit('select', null)">
    <h1 class="text-xl font-semibold tracking-tight mb-5">{{ spec.title }}</h1>
    <template v-for="(g, gi) in groups" :key="gi">
      <div :class="['rounded-md -mx-3 px-3 py-1 transition-colors', g.picked ? 'bg-primary/5 ring-1 ring-primary/50' : '']">
        <div
          v-for="i in g.items"
          :key="i"
          :class="['cursor-pointer rounded', g.picked ? '' : 'hover:bg-neutral-50 -mx-3 px-3 py-1 rounded-md']"
          role="button"
          tabindex="0"
          @click.stop="pick(i)"
          @keydown.enter.prevent="pick(i)"
          @keydown.space.prevent="pick(i)"
        >
          <template v-for="(b, only) in [spec.blocks[i]!]" :key="only">
            <component :is="`h${Math.min(b.type === 'heading' ? b.level + 1 : 3, 4)}`" v-if="b.type === 'heading'" :class="[sizes[b.level - 1] ?? 'text-sm', 'font-semibold tracking-tight mt-1 mb-1']">{{ b.text }}</component>
            <p v-else-if="b.type === 'paragraph'" class="mb-1 whitespace-pre-line">{{ b.text }}</p>
            <ul v-else-if="b.type === 'bullets'" class="list-disc ps-5 space-y-0.5 mb-1"><li v-for="(item, k) in b.items" :key="k">{{ item }}</li></ul>
            <ol v-else-if="b.type === 'numbered'" class="list-decimal ps-5 space-y-0.5 mb-1"><li v-for="(item, k) in b.items" :key="k">{{ item }}</li></ol>
            <table v-else-if="b.type === 'table'" class="w-full text-left border-collapse my-1">
              <thead><tr class="border-b border-neutral-300"><th v-for="(h, k) in b.header" :key="k" class="py-1.5 pe-3 font-medium">{{ h }}</th></tr></thead>
              <tbody><tr v-for="(row, r) in b.rows" :key="r" class="border-b border-neutral-100 last:border-0"><td v-for="(c, k) in row" :key="k" class="py-1.5 pe-3">{{ c }}</td></tr></tbody>
            </table>
          </template>
        </div>
      </div>
      <div v-if="g.picked" class="-mx-3 my-2 text-default">
        <ChangeBox :placeholder="example" :busy="busy" :label="label" @change="emit('change', $event)" />
      </div>
    </template>
  </article>
</template>
