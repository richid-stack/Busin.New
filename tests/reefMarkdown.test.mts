import { parseMarkdown } from '@comark/vue/parse'
import { safeNodes } from '../src/utils/safeMarkdown'
import type { RawNode, SafeNode } from '../src/utils/safeMarkdown'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const read = async (md: string) => safeNodes((await parseMarkdown(md)).nodes as RawNode[])
const text = (n: SafeNode[]): string => n.map(x => (typeof x === 'string' ? x : text(x.children))).join('')
const tags = (n: SafeNode[]): string[] => n.flatMap(x => (typeof x === 'string' ? [] : [x.tag, ...tags(x.children)]))
const json = (n: SafeNode[]) => JSON.stringify(n)

const hostile = await read('# Hi\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1))\n<a href="javascript:alert(2)" onclick="x()">raw</a>\n<iframe src="https://evil.example"></iframe>\n![p](https://evil.example/track.png)\n\n[x]{onclick="alert(1)"}\n\n<div style="position:fixed" onmouseover="steal()">boo</div>\n\n<style>body{display:none}</style>\n<form action="https://evil.example"><input name=pw></form>')
const out = json(hostile)
const objects = (n: SafeNode[]): Array<Exclude<SafeNode, string>> => n.flatMap(x => (typeof x === 'string' ? [] : [x, ...objects(x.children)]))
assert(objects(hostile).every(o => Object.keys(o).every(k => ['tag', 'href', 'children'].includes(k))) && !objects(hostile).some(o => o.href), 'nothing carries an attribute: no handlers, styles or addresses (a javascript: link is left as plain text)')
assert(!out.includes('track.png"') || !objects(hostile).some(o => o.tag === 'img'), 'no image is drawn, so nothing loads from a stranger\'s server')
assert(!tags(hostile).some(t => ['script', 'iframe', 'img', 'style', 'form', 'div', 'input'].includes(t)), 'only plain tags are drawn')
assert(text(hostile).includes('Hi') && text(hostile).includes('raw') && text(hostile).includes('boo'), 'the words inside still show')

const ok = await read('Hello **world** `code`\n\n[site](https://example.com) and [mail](mailto:a@b.co)\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet a = 1\n```\n\n- [x] done\n- [ ] todo')
assert(tags(ok).includes('strong') && tags(ok).includes('code') && tags(ok).includes('ul') && tags(ok).includes('table') && tags(ok).includes('pre'), 'ordinary markdown is drawn')
const links = JSON.stringify(ok).match(/"href":"[^"]+"/g) ?? []
assert(links.length === 2 && links.every(l => /https:\/\/example\.com|mailto:a@b\.co/.test(l)), 'web and email links keep their address')
assert(text(ok).includes('☑ ') && text(ok).includes('☐ '), 'task lists show as ticks')
const bad = await read('[a](data:text/html;base64,AAAA) [b](vbscript:x) [c](//evil.example) [d](/relative)')
assert(!/"href"/.test(json(bad)), 'data:, vbscript:, protocol-less and relative links are not links')
assert(safeNodes([]).length === 0 && (await read('')).length === 0, 'nothing in, nothing out')
console.log(process.exitCode ? 'Reef markdown tests FAILED' : 'Reef markdown tests OK')
