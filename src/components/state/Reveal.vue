<script setup lang="ts">
// The "slides out of the edge" motion for anything that opens in the flow of the page (a trace detail, a
// read-more, a form that appears). It grows downward from its top edge and pushes what is below it.
// Wrap the thing that comes and goes: <Reveal><div v-if="open">…</div></Reveal>
const OPEN_MS = 200
const CLOSE_MS = 120
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_IN = 'cubic-bezier(0.55, 0, 0.8, 0.4)'
const reduce = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function enter(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (reduce()) return done()
  const h = node.scrollHeight
  node.style.overflow = 'hidden'
  const anim = node.animate(
    [{ height: '0px', opacity: 0, transform: 'translateY(-6px)' }, { height: `${h}px`, opacity: 1, transform: 'none' }],
    { duration: OPEN_MS, easing: EASE_OUT }
  )
  anim.onfinish = () => { node.style.overflow = ''; done() }
  anim.oncancel = () => { node.style.overflow = ''; done() }
}

function leave(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (reduce()) return done()
  const h = node.offsetHeight
  node.style.overflow = 'hidden'
  const anim = node.animate(
    [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
    { duration: CLOSE_MS, easing: EASE_IN, fill: 'forwards' }
  )
  anim.onfinish = () => done()
  anim.oncancel = () => done()
}
</script>

<template>
  <Transition :css="false" @enter="enter" @leave="leave">
    <slot />
  </Transition>
</template>
