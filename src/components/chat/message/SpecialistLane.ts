import { defineComponent, h } from 'vue'

/**
 * Puts the steps a specialist takes in a lane with a hairline on the left. With no specialist it adds nothing at all
 * (it returns its children as they are), so every other step is drawn exactly as before.
 */
export default defineComponent({
  name: 'SpecialistLane',
  props: { id: { type: String, default: '' } },
  setup(props, { slots }) {
    return () => (props.id
      ? h('div', { class: '-my-2 ml-1.5 border-l border-default py-2 pl-4', 'data-specialist': props.id }, slots.default?.())
      : slots.default?.())
  }
})
