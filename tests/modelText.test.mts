import { withoutSourceMarks } from '../shared/modelText'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

assert(withoutSourceMarks('1 Ghana cedi ≈ $0.0855 USD (as shown by XE)【2†L12-L15】') === '1 Ghana cedi ≈ $0.0855 USD (as shown by XE)', 'a source marker at the end is removed with its space')
assert(withoutSourceMarks('Rate is 0.0855 【4†L1-L3】 and rising 【4†L9】.') === 'Rate is 0.0855 and rising.', 'markers in the middle are removed and the sentence closes up')
assert(withoutSourceMarks('Plain answer, no marks.') === 'Plain answer, no marks.', 'text without markers is untouched')
assert(withoutSourceMarks('Use 【brackets】 sparingly') === 'Use sparingly', 'any full-width bracket pair is taken out')
assert(withoutSourceMarks('Line one【1†L1】\nLine two') === 'Line one\nLine two', 'line breaks stay')
