<script setup lang="ts">
import { computed } from 'vue'
import type { PartSelection, PresentationContent, Slide } from '../../types/artifacts'
import ChangeBox from './ChangeBox.vue'

const props = defineProps<{ spec: PresentationContent, selection: PartSelection | null, busy: boolean, label: string }>()
const emit = defineEmits<{ select: [sel: PartSelection], change: [text: string] }>()

const at = computed(() => Math.min(Math.max(props.selection?.from ?? 1, 1), props.spec.slides.length))
const slide = computed(() => props.spec.slides[at.value - 1] as Slide)
const go = (n: number) => emit('select', { from: n, to: n })
const title = (s: Slide) => s.title
</script>

<template>
  <div class="mx-auto max-w-[600px] flex flex-col gap-4">
    <div class="aspect-video rounded-lg bg-white shadow-md ring-2 ring-primary/60 text-neutral-900 p-8 flex flex-col justify-center overflow-hidden">
      <p class="text-[11px] uppercase tracking-widest text-neutral-400 mb-2">
        Slide {{ at }} of {{ spec.slides.length }}
      </p>
      <template v-if="slide.layout === 'title'">
        <h2 class="text-3xl font-semibold tracking-tight mb-2">
          {{ slide.title }}
        </h2>
        <p
          v-if="slide.subtitle"
          class="text-sm text-neutral-600"
        >
          {{ slide.subtitle }}
        </p>
      </template>
      <template v-else-if="slide.layout === 'content'">
        <h2 class="text-2xl font-semibold tracking-tight mb-3">
          {{ slide.title }}
        </h2>
        <ul
          v-if="slide.bullets?.length"
          class="text-sm text-neutral-700 space-y-1.5 list-disc ps-5"
        >
          <li
            v-for="(b, i) in slide.bullets"
            :key="i"
          >
            {{ b }}
          </li>
        </ul>
        <p
          v-if="slide.text"
          class="text-sm text-neutral-700 whitespace-pre-line"
        >
          {{ slide.text }}
        </p>
      </template>
      <template v-else>
        <h2 class="text-xl font-semibold tracking-tight mb-3">
          {{ slide.title }}
        </h2>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300">
              <th
                v-for="(h, k) in slide.header"
                :key="k"
                class="py-1 pe-2 font-medium"
              >
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, r) in slide.rows"
              :key="r"
              class="border-b border-neutral-100"
            >
              <td
                v-for="(c, k) in row"
                :key="k"
                class="py-1 pe-2"
              >
                {{ c }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
    <ChangeBox
      :placeholder="'Ask for a change, e.g. “add a number”'"
      :busy="busy"
      :label="label"
      @change="emit('change', $event)"
    />
    <div class="grid grid-cols-4 gap-2">
      <button
        v-for="(s, i) in spec.slides"
        :key="i"
        type="button"
        :aria-label="`Slide ${i + 1}: ${title(s)}`"
        :class="['aspect-video rounded-md bg-white shadow-sm text-[9px] text-neutral-500 text-left flex flex-col justify-end p-1.5 overflow-hidden leading-tight', i + 1 === at ? 'ring-2 ring-primary/60' : 'ring-1 ring-black/5 hover:ring-black/20']"
        @click="go(i + 1)"
      >
        <span class="text-neutral-400">{{ i + 1 }}</span><span class="line-clamp-2">{{ title(s) }}</span>
      </button>
    </div>
  </div>
</template>
