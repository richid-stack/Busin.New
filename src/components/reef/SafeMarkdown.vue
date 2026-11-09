<script setup lang="ts">
import { h, ref, watchEffect } from 'vue'
import type { VNode } from 'vue'
import { parseMarkdown } from '@comark/vue/parse'
import { safeNodes } from '../../utils/safeMarkdown'
import type { RawNode, SafeNode } from '../../utils/safeMarkdown'

/** Shows a README written by a stranger, drawn only from a short list of plain tags (see utils/safeMarkdown). */
const props = defineProps<{ value: string }>()

const tree = ref<SafeNode[]>([])

watchEffect(async (onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  try {
    const doc = await parseMarkdown(props.value ?? '')
    if (!stale) tree.value = safeNodes(doc.nodes as RawNode[])
  } catch {
    if (!stale) tree.value = [props.value ?? '']
  }
})

function draw(node: SafeNode, key: string): VNode | string {
  if (typeof node === 'string') return node
  const kids = node.children.map((c, i) => draw(c, `${key}.${i}`))
  if (node.tag === 'a') return h('a', { key, href: node.href, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, kids)
  return h(node.tag, { key }, kids.length ? kids : undefined)
}

const Render = () => h('div', { class: 'reef-md' }, tree.value.map((n, i) => draw(n, String(i))))
</script>

<template>
  <Render />
</template>

<style>
.reef-md { font-size: 15px; line-height: 1.7; color: var(--ui-text); overflow-wrap: anywhere; }
.reef-md > *:first-child { margin-top: 0; }
.reef-md > *:last-child { margin-bottom: 0; }
.reef-md h1, .reef-md h2, .reef-md h3, .reef-md h4 { color: var(--ui-text-highlighted); font-weight: 600; line-height: 1.3; margin: 1.6em 0 0.5em; }
.reef-md h1 { font-size: 1.6em; padding-bottom: 0.3em; border-bottom: 1px solid var(--ui-border); margin-top: 0; }
.reef-md h2 { font-size: 1.3em; padding-bottom: 0.25em; border-bottom: 1px solid var(--ui-border); }
.reef-md h3 { font-size: 1.1em; }
.reef-md p, .reef-md ul, .reef-md ol, .reef-md pre, .reef-md blockquote, .reef-md table { margin: 0 0 1em; }
.reef-md ul { list-style: disc; padding-left: 1.4em; }
.reef-md ol { list-style: decimal; padding-left: 1.4em; }
.reef-md li { margin: 0.25em 0; }
.reef-md a { color: var(--ui-primary); text-decoration: underline; text-underline-offset: 2px; }
.reef-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; background: var(--ui-bg-elevated); padding: 0.15em 0.4em; border-radius: 6px; }
.reef-md pre { background: var(--ui-bg-elevated); border: 1px solid var(--ui-border); border-radius: 10px; padding: 12px 14px; overflow-x: auto; }
.reef-md pre code { background: none; padding: 0; }
.reef-md blockquote { border-left: 3px solid var(--ui-border-accented); padding-left: 1em; color: var(--ui-text-muted); }
.reef-md table { border-collapse: collapse; display: block; overflow-x: auto; }
.reef-md th, .reef-md td { border: 1px solid var(--ui-border); padding: 6px 12px; text-align: left; }
.reef-md th { background: var(--ui-bg-elevated); font-weight: 600; }
.reef-md hr { border: 0; border-top: 1px solid var(--ui-border); margin: 1.5em 0; }
.reef-md-img { color: var(--ui-text-muted); font-style: italic; }
</style>
