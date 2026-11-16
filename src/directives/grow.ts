import type { Directive } from 'vue'
import { EASE_IN, EASE_OUT, motionReduced } from '../utils/motion'

// The message box grows with what you type (more lines, an attachment appears). The browser changes its
// height in one jump; this makes the edge slide out instead, the same motion as a trace opening.
// Use it on any box whose height follows its content: <UChatPrompt v-grow />
const GROW_MS = 180
const SHRINK_MS = 120
const MAX_JUMP = 360 // a bigger change (a whole panel opening) is not typing; leave it alone

interface State { observer: ResizeObserver, last: number, running: boolean }
const states = new WeakMap<HTMLElement, State>()

export const vGrow: Directive<HTMLElement> = {
  mounted(el) {
    if (typeof ResizeObserver === 'undefined') return
    const state: State = { observer: undefined as unknown as ResizeObserver, last: el.getBoundingClientRect().height, running: false }
    state.observer = new ResizeObserver(() => {
      if (state.running) return
      const next = el.getBoundingClientRect().height
      const from = state.last
      state.last = next
      if (!from || !next || Math.abs(next - from) < 2 || Math.abs(next - from) > MAX_JUMP) return
      if (motionReduced() || document.hidden) return
      const growing = next > from
      const previousOverflow = el.style.overflow
      el.style.overflow = 'hidden'
      state.running = true
      const done = () => {
        el.style.overflow = previousOverflow
        state.running = false
        state.last = el.getBoundingClientRect().height
      }
      const anim = el.animate(
        [{ height: `${from}px` }, { height: `${next}px` }],
        { duration: growing ? GROW_MS : SHRINK_MS, easing: growing ? EASE_OUT : EASE_IN }
      )
      anim.onfinish = done
      anim.oncancel = done
    })
    state.observer.observe(el)
    states.set(el, state)
  },
  unmounted(el) {
    states.get(el)?.observer.disconnect()
    states.delete(el)
  }
}
