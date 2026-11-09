<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, useId, watch } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'

/**
 * Lobby's face: the OpenLobs lobster, moved by real sound.
 *
 *  - Listening: the claws lift to its ears and tremble with how loud you are; the antennae lift.
 *  - Speaking: a mouth opens with how loud Lobby is, with sound coming out; the claws gesture a little.
 *  - Working: the claws tap slowly, one then the other, and the antennae sweep.
 *  - Paused: eyes closed, claws down.
 *
 * `level` is a real loudness reading from 0 to 1 (the microphone while it listens, the audio while it speaks).
 * With reduced motion it holds the pose for the state and does not move.
 */
const props = withDefaults(defineProps<{
  state: 'idle' | 'listening' | 'thinking' | 'speaking'
  level?: number
  size?: number
}>(), { level: 0, size: 30 })

const gid = `shell-${useId()}`
const reduced = usePreferredReducedMotion()
const v = reactive({ t: 0, level: 0, raise: 0, speak: 0, work: 0, rest: 1 })

const goal = () => ({
  raise: props.state === 'listening' ? 1 : 0,
  speak: props.state === 'speaking' ? 1 : 0,
  work: props.state === 'thinking' ? 1 : 0,
  rest: props.state === 'idle' ? 1 : 0
})

let raf = 0
let last = 0
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)

function frame(ts: number) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016
  last = ts
  const g = goal()
  v.t += dt
  v.level += (Math.max(0, Math.min(1, props.level)) - v.level) * ease(dt, 14)
  v.raise += (g.raise - v.raise) * ease(dt, 3)
  v.speak += (g.speak - v.speak) * ease(dt, 4)
  v.work += (g.work - v.work) * ease(dt, 3)
  v.rest += (g.rest - v.rest) * ease(dt, 2.6)
  raf = requestAnimationFrame(frame)
}

function snap() {
  Object.assign(v, goal(), { level: 0 })
}

onMounted(() => {
  if (reduced.value === 'reduce') snap()
  else raf = requestAnimationFrame(frame)
})
watch(() => props.state, () => { if (reduced.value === 'reduce') snap() })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const pose = computed(() => {
  const lvl = v.level
  const tap = v.work * Math.sin(v.t * 5)
  const base = v.raise * (30 + lvl * 8) - v.speak * (3 + lvl * 9) - v.rest * 10
  const perk = v.raise * (12 + lvl * 4) + v.work * Math.sin(v.t * 3) * 8 + v.speak * 3 - v.rest * 8
  const eye = 1 - v.rest * 0.88
  const sound = lvl * v.speak
  return {
    antL: `rotate(${perk.toFixed(2)} 28 20)`,
    antR: `rotate(${(-perk).toFixed(2)} 36 20)`,
    armL: `rotate(${(base + tap * 7).toFixed(2)} 25 30)`,
    armR: `rotate(${(-(base - tap * 7)).toFixed(2)} 39 30)`,
    eyes: `translate(0 22.2) scale(1 ${eye.toFixed(3)}) translate(0 -22.2)`,
    mouthOpacity: clamp(v.speak * 1.4, 0, 1).toFixed(2),
    mouthRy: (0.55 + lvl * 3.4).toFixed(2),
    arc1: clamp(sound * 2.6, 0, 1).toFixed(2),
    arc3: clamp(sound * 2.6 - 1.1, 0, 1).toFixed(2)
  }
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    class="shrink-0 overflow-visible"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        :id="gid"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="#FF6B5E"
        />
        <stop
          offset="1"
          stop-color="#D93A3A"
        />
      </linearGradient>
    </defs>
    <g :transform="pose.antL">
      <path
        d="M28 20 C24 12 20 8 14 6"
        fill="none"
        stroke="#B82E34"
        stroke-width="2.6"
        stroke-linecap="round"
      />
    </g>
    <g :transform="pose.antR">
      <path
        d="M36 20 C40 12 44 8 50 6"
        fill="none"
        stroke="#B82E34"
        stroke-width="2.6"
        stroke-linecap="round"
      />
    </g>
    <g :transform="pose.armL">
      <path
        d="M25 30 C18 30 14 26 12 22"
        fill="none"
        stroke="#D93A3A"
        stroke-width="4.4"
        stroke-linecap="round"
      />
      <path
        :fill="`url(#${gid})`"
        d="M12 22 C3 20 1 10 6 6 C8 4 10 6 10 9 C11 7 14 7 15 10 C18 13 18 20 12 22 Z"
      />
    </g>
    <g :transform="pose.armR">
      <path
        d="M39 30 C46 30 50 26 52 22"
        fill="none"
        stroke="#D93A3A"
        stroke-width="4.4"
        stroke-linecap="round"
      />
      <path
        :fill="`url(#${gid})`"
        d="M52 22 C61 20 63 10 58 6 C56 4 54 6 54 9 C53 7 50 7 49 10 C46 13 46 20 52 22 Z"
      />
    </g>
    <ellipse
      cx="32"
      cy="45"
      rx="8"
      ry="7"
      fill="#D93A3A"
    />
    <ellipse
      cx="32"
      cy="32"
      rx="11"
      ry="15"
      :fill="`url(#${gid})`"
    />
    <g :transform="pose.eyes">
      <circle
        cx="27.5"
        cy="22"
        r="3.2"
        fill="#fff"
      />
      <circle
        cx="36.5"
        cy="22"
        r="3.2"
        fill="#fff"
      />
      <circle
        cx="28"
        cy="22.3"
        r="1.7"
        fill="#1B1B1F"
      />
      <circle
        cx="36"
        cy="22.3"
        r="1.7"
        fill="#1B1B1F"
      />
    </g>
    <ellipse
      cx="32"
      cy="29"
      rx="3.4"
      :ry="pose.mouthRy"
      fill="#6b1519"
      :opacity="pose.mouthOpacity"
    />
    <path
      d="M27 34 Q32 37 37 34"
      fill="none"
      stroke="#fff"
      stroke-width="1.9"
      stroke-linecap="round"
      :opacity="pose.arc1"
    />
    <path
      d="M23.6 38.2 Q32 42.6 40.4 38.2"
      fill="none"
      stroke="#fff"
      stroke-width="1.9"
      stroke-linecap="round"
      :opacity="pose.arc3"
    />
  </svg>
</template>
