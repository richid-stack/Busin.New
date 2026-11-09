import { readFileSync } from 'node:fs'
const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const card = readFileSync(new URL('../src/components/chat/tool/Approval.vue', import.meta.url), 'utf8')

// What is approved must be what is shown.
assert(!/\.slice\(\s*0\s*,\s*\d+\s*\)/.test(card), 'no input is dropped from the card')
assert(!/line-clamp/.test(card), 'a long value is not cut to a few lines')
assert(/overflow-y-auto/.test(card) && /max-h-/.test(card), 'a long value scrolls inside its box instead')
// A failed answer must not lock the card.
assert(/try \{\s*await respond/.test(card) && /catch \{[^}]*answered\.value = null/s.test(card), 'if the answer does not go through, the buttons come back')
console.log(process.exitCode ? 'Approval card tests FAILED' : 'Approval card tests OK')
