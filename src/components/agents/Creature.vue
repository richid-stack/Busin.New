<script setup lang="ts">
import { computed } from 'vue'

// Every saved agent is a small creature. They are built from the same rounded, geometric pieces as the OpenLobs mark,
// so they read as one family. A creature has a mood, shown mostly through the eyes: idle, asking (it wants something
// from you), working, done.
export type Species = 'pangolin' | 'chameleon' | 'hornbill' | 'galago' | 'fennec' | 'tortoise' | 'sunbird' | 'weaverbird' | 'beetle' | 'aardvark'
export type Mood = 'idle' | 'asking' | 'working' | 'done'

const props = withDefaults(defineProps<{ species: Species, mood?: Mood, size?: number, animate?: boolean }>(), { mood: 'idle', size: 64, animate: false })

const INK = '#18181b'
const EYES: Record<Species, { x: number, y: number, r: number }[]> = {
  pangolin: [{ x: 80, y: 52, r: 2.7 }],
  chameleon: [{ x: 74, y: 44, r: 3.6 }],
  hornbill: [{ x: 66, y: 36, r: 2.8 }],
  galago: [{ x: 35, y: 50, r: 7 }, { x: 61, y: 50, r: 7 }],
  fennec: [{ x: 38, y: 54, r: 3 }, { x: 58, y: 54, r: 3 }],
  tortoise: [{ x: 88, y: 56, r: 2.6 }],
  sunbird: [{ x: 66, y: 40, r: 2.5 }],
  weaverbird: [{ x: 67, y: 40, r: 2.4 }],
  beetle: [{ x: 14, y: 63, r: 2.3 }],
  aardvark: [{ x: 75, y: 44, r: 2.6 }]
}
const eyes = computed(() => EYES[props.species])
const tilt = computed(() => (props.mood === 'asking' ? -5 : 0))
</script>

<template>
  <svg
    viewBox="0 0 96 96"
    :width="size"
    :height="size"
    role="img"
    :aria-label="`${species}, ${mood}`"
    class="shrink-0 overflow-visible"
    :class="animate && mood === 'working' ? 'creature-bob' : ''"
  >
    <g :transform="`rotate(${tilt} 48 60)`">
      <!-- PANGOLIN -->
      <template v-if="species === 'pangolin'">
        <ellipse
          cx="13"
          cy="60"
          rx="13"
          ry="6"
          transform="rotate(-24 13 60)"
          fill="#B87A50"
        />
        <rect
          x="32"
          y="68"
          width="10"
          height="15"
          rx="5"
          fill="#9A623E"
        />
        <rect
          x="56"
          y="68"
          width="10"
          height="15"
          rx="5"
          fill="#9A623E"
        />
        <clipPath id="pg-body"><ellipse
          cx="46"
          cy="56"
          rx="32"
          ry="24"
        /></clipPath>
        <ellipse
          cx="46"
          cy="56"
          rx="32"
          ry="24"
          fill="#C98F5F"
        />
        <g
          clip-path="url(#pg-body)"
          fill="none"
          stroke="#A66B43"
          stroke-width="1.7"
        >
          <circle
            v-for="(c, i) in [[26,42],[42,42],[58,42],[74,42],[34,54],[50,54],[66,54],[26,66],[42,66],[58,66],[74,66]]"
            :key="i"
            :cx="c[0]"
            :cy="c[1]"
            r="9"
          />
        </g>
        <path
          d="M68 52 C72 40 88 44 94 56 C90 65 78 67 68 64 Z"
          fill="#E8C29A"
        />
        <circle
          cx="93.2"
          cy="56"
          r="1.9"
          :fill="INK"
        />
      </template>

      <!-- CHAMELEON -->
      <template v-else-if="species === 'chameleon'">
        <rect
          x="2"
          y="77"
          width="92"
          height="5"
          rx="2.5"
          fill="#7A6450"
        />
        <path
          d="M28 62 C10 64 5 44 17 41 C28 39 31 54 22 55"
          fill="none"
          stroke="#7E9C76"
          stroke-width="7"
          stroke-linecap="round"
        />
        <rect
          x="34"
          y="68"
          width="8"
          height="11"
          rx="4"
          fill="#7E9C76"
        />
        <rect
          x="56"
          y="68"
          width="8"
          height="11"
          rx="4"
          fill="#7E9C76"
        />
        <ellipse
          cx="46"
          cy="58"
          rx="25"
          ry="18"
          fill="#93B08A"
        />
        <path
          d="M26 50 C34 42 56 42 66 50"
          fill="none"
          stroke="#7E9C76"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray="1 7"
        />
        <path
          d="M58 44 C60 26 82 26 88 42 C90 54 66 62 58 52 Z"
          fill="#A4BE98"
        />
        <circle
          cx="74"
          cy="44"
          r="9.5"
          fill="#D6E4C6"
          stroke="#6C8964"
          stroke-width="2"
        />
        <path
          d="M84 53 Q91 52 93 47"
          fill="none"
          stroke="#6C8964"
          stroke-width="2"
          stroke-linecap="round"
        />
      </template>

      <!-- HORNBILL -->
      <template v-else-if="species === 'hornbill'">
        <path
          d="M10 62 L32 56 L35 74 L13 78 Z"
          fill="#2E2E33"
          stroke="#2E2E33"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <path
          d="M42 78 V90 M52 78 V90"
          stroke="#7A6450"
          stroke-width="3"
          stroke-linecap="round"
        />
        <ellipse
          cx="42"
          cy="60"
          rx="25"
          ry="19"
          fill="#3C3C42"
        />
        <ellipse
          cx="49"
          cy="66"
          rx="14"
          ry="11"
          fill="#EFEADF"
        />
        <circle
          cx="64"
          cy="38"
          r="14"
          fill="#3C3C42"
        />
        <path
          d="M72 31 C88 28 100 35 97 52 C92 44 82 42 72 43 Z"
          fill="#EBA93A"
        />
        <path
          d="M72 43 C83 43 91 45 94 50 C87 52 79 51 72 48 Z"
          fill="#D68A1C"
        />
        <path
          d="M74 31 C78 20 90 20 94 32 C86 29 80 29 74 31 Z"
          fill="#D68A1C"
        />
        <circle
          cx="66"
          cy="36"
          r="5.4"
          fill="#EFEADF"
        />
      </template>

      <!-- GALAGO -->
      <template v-else-if="species === 'galago'">
        <path
          d="M66 82 C86 84 90 62 78 58"
          fill="none"
          stroke="#A8957A"
          stroke-width="7"
          stroke-linecap="round"
        />
        <ellipse
          cx="48"
          cy="79"
          rx="18"
          ry="14"
          fill="#B7A387"
        />
        <ellipse
          cx="25"
          cy="30"
          rx="11"
          ry="17"
          transform="rotate(-20 25 30)"
          fill="#B7A387"
        />
        <ellipse
          cx="25"
          cy="31"
          rx="6"
          ry="11"
          transform="rotate(-20 25 31)"
          fill="#E4CFC1"
        />
        <ellipse
          cx="71"
          cy="30"
          rx="11"
          ry="17"
          transform="rotate(20 71 30)"
          fill="#B7A387"
        />
        <ellipse
          cx="71"
          cy="31"
          rx="6"
          ry="11"
          transform="rotate(20 71 31)"
          fill="#E4CFC1"
        />
        <ellipse
          cx="48"
          cy="51"
          rx="27"
          ry="24"
          fill="#C9B79C"
        />
        <ellipse
          cx="35"
          cy="50"
          rx="12.5"
          ry="12.5"
          fill="#6F5E4A"
        />
        <ellipse
          cx="61"
          cy="50"
          rx="12.5"
          ry="12.5"
          fill="#6F5E4A"
        />
        <ellipse
          cx="48"
          cy="61"
          rx="3.2"
          ry="2.3"
          :fill="INK"
        />
        <path
          d="M45 66 Q48 68.5 51 66"
          fill="none"
          :stroke="INK"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </template>

      <!-- FENNEC -->
      <template v-else-if="species === 'fennec'">
        <path
          d="M24 48 L12 6 Q32 12 42 38 Z"
          fill="#E4BD8A"
        />
        <path
          d="M25 42 L18 17 Q28 22 35 38 Z"
          fill="#D69A88"
        />
        <path
          d="M72 48 L84 6 Q64 12 54 38 Z"
          fill="#E4BD8A"
        />
        <path
          d="M71 42 L78 17 Q68 22 61 38 Z"
          fill="#D69A88"
        />
        <ellipse
          cx="48"
          cy="57"
          rx="27"
          ry="22"
          fill="#E9C995"
        />
        <path
          d="M23 60 Q48 92 73 60 Q61 82 48 82 Q35 82 23 60 Z"
          fill="#F7EFDF"
        />
        <ellipse
          cx="48"
          cy="66"
          rx="3.6"
          ry="2.7"
          :fill="INK"
        />
        <path
          d="M44 71 Q48 74 52 71"
          fill="none"
          :stroke="INK"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </template>

      <!-- SUNBIRD -->
      <template v-else-if="species === 'sunbird'">
        <rect
          x="6"
          y="80"
          width="86"
          height="4"
          rx="2"
          fill="#7A6450"
        />
        <path
          d="M6 62 L26 56 L30 70 L10 76 Z"
          fill="#2B6F63"
          stroke="#2B6F63"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <path
          d="M40 72 V81 M50 72 V81"
          stroke="#5B4A3A"
          stroke-width="2.5"
          stroke-linecap="round"
        />
        <ellipse
          cx="42"
          cy="58"
          rx="21"
          ry="15"
          fill="#3E8E7E"
        />
        <ellipse
          cx="46"
          cy="64"
          rx="13"
          ry="9"
          fill="#F2C94C"
        />
        <path
          d="M34 52 C42 46 54 48 58 54"
          fill="none"
          stroke="#2B6F63"
          stroke-width="3"
          stroke-linecap="round"
        />
        <circle
          cx="62"
          cy="43"
          r="11"
          fill="#2E7567"
        />
        <path
          d="M71 41 C84 38 94 45 97 56 C90 51 81 48 71 47 Z"
          fill="#3A3A3E"
        />
        <path
          d="M54 50 C58 54 64 54 68 50"
          fill="none"
          stroke="#C9523A"
          stroke-width="3"
          stroke-linecap="round"
        />
      </template>

      <!-- WEAVERBIRD -->
      <template v-else-if="species === 'weaverbird'">
        <path
          d="M8 64 L28 58 L32 74 L12 78 Z"
          fill="#D9AE22"
          stroke="#D9AE22"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <path
          d="M42 76 V88 M52 76 V88"
          stroke="#7A6450"
          stroke-width="3"
          stroke-linecap="round"
        />
        <ellipse
          cx="42"
          cy="60"
          rx="24"
          ry="18"
          fill="#F0C93A"
        />
        <path
          d="M30 56 C40 50 52 54 56 62"
          fill="none"
          stroke="#D9AE22"
          stroke-width="3"
          stroke-linecap="round"
        />
        <circle
          cx="62"
          cy="40"
          r="13"
          fill="#F0C93A"
        />
        <ellipse
          cx="67"
          cy="40"
          rx="8.5"
          ry="7"
          fill="#26262a"
        />
        <path
          d="M73 44 L86 47 L73 51 Z"
          fill="#7A6450"
        />
        <path
          d="M82 48 C92 52 94 64 88 76"
          fill="none"
          stroke="#7E9C4E"
          stroke-width="2.6"
          stroke-linecap="round"
        />
      </template>

      <!-- DUNG BEETLE -->
      <template v-else-if="species === 'beetle'">
        <circle
          cx="68"
          cy="62"
          r="19"
          fill="#8E6D4B"
        />
        <path
          d="M56 54 C62 46 74 46 80 52"
          fill="none"
          stroke="#A88862"
          stroke-width="2.5"
          stroke-linecap="round"
        />
        <path
          d="M26 74 L22 84 M38 76 L36 86 M50 74 L52 84"
          stroke="#2F3748"
          stroke-width="3"
          stroke-linecap="round"
        />
        <ellipse
          cx="34"
          cy="62"
          rx="20"
          ry="14"
          fill="#43506A"
        />
        <path
          d="M34 49 V75"
          stroke="#2F3748"
          stroke-width="2"
        />
        <circle
          cx="15"
          cy="66"
          r="8"
          fill="#2F3748"
        />
        <path
          d="M10 59 L5 52 M16 58 L16 50"
          stroke="#2F3748"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </template>

      <!-- AARDVARK -->
      <template v-else-if="species === 'aardvark'">
        <path
          d="M18 62 C6 62 4 72 12 76 L24 72 Z"
          fill="#9C8F80"
          stroke="#9C8F80"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <rect
          x="30"
          y="68"
          width="10"
          height="16"
          rx="5"
          fill="#8E8174"
        />
        <rect
          x="54"
          y="68"
          width="10"
          height="16"
          rx="5"
          fill="#8E8174"
        />
        <ellipse
          cx="44"
          cy="58"
          rx="28"
          ry="20"
          fill="#B0A394"
        />
        <ellipse
          cx="62"
          cy="30"
          rx="6"
          ry="14"
          transform="rotate(14 62 30)"
          fill="#B0A394"
        />
        <ellipse
          cx="62"
          cy="31"
          rx="3"
          ry="9"
          transform="rotate(14 62 31)"
          fill="#D6B7AB"
        />
        <circle
          cx="70"
          cy="46"
          r="14"
          fill="#B0A394"
        />
        <path
          d="M78 42 C90 40 97 48 95 57 C89 57 82 55 76 55 Z"
          fill="#CBBDAA"
        />
        <circle
          cx="94"
          cy="50"
          r="2"
          :fill="INK"
        />
      </template>

      <!-- TORTOISE -->
      <template v-else>
        <rect
          x="24"
          y="66"
          width="12"
          height="15"
          rx="5.5"
          fill="#8CA593"
        />
        <rect
          x="56"
          y="66"
          width="12"
          height="15"
          rx="5.5"
          fill="#8CA593"
        />
        <circle
          cx="86"
          cy="57"
          r="9.5"
          fill="#A9BFA6"
        />
        <path
          d="M12 68 C12 28 82 28 82 68 Z"
          fill="#6F9C8A"
        />
        <path
          d="M47 35 V68 M23 53 H72 M29 40 L35 53 M65 40 L59 53 M21 68 L27 53 M73 68 L67 53"
          fill="none"
          stroke="#4E7767"
          stroke-width="2"
          stroke-linecap="round"
        />
        <rect
          x="11"
          y="65"
          width="72"
          height="7"
          rx="3.5"
          fill="#4E7767"
        />
      </template>

      <!-- EYES: the mood lives here -->
      <template
        v-for="(e, i) in eyes"
        :key="i"
      >
        <path
          v-if="mood === 'done'"
          :d="`M${e.x - e.r * 1.1} ${e.y + 1} Q${e.x} ${e.y - e.r * 1.4} ${e.x + e.r * 1.1} ${e.y + 1}`"
          fill="none"
          :stroke="INK"
          stroke-width="2"
          stroke-linecap="round"
        />
        <template v-else-if="mood === 'working'">
          <ellipse
            :cx="e.x"
            :cy="e.y + 1.4"
            :rx="e.r"
            :ry="e.r * 0.55"
            :fill="INK"
          />
        </template>
        <template v-else>
          <circle
            :cx="e.x + (mood === 'asking' ? e.r * 0.28 : 0)"
            :cy="e.y"
            :r="e.r * (mood === 'asking' ? 1.08 : 1)"
            :fill="INK"
          />
          <circle
            :cx="e.x + e.r * 0.3 + (mood === 'asking' ? e.r * 0.28 : 0)"
            :cy="e.y - e.r * 0.34"
            :r="e.r * 0.3"
            fill="#fff"
          />
        </template>
      </template>
    </g>
  </svg>
</template>

<style scoped>
.creature-bob { animation: creature-bob 1.1s ease-in-out infinite; }
@keyframes creature-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@media (prefers-reduced-motion: reduce) { .creature-bob { animation: none } }
</style>
