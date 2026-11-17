import { DEFAULT_PREFERENCES, exactTime, parsePreferences } from '../src/utils/preferences'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

assert(JSON.stringify(parsePreferences(null)) === JSON.stringify(DEFAULT_PREFERENCES) && JSON.stringify(parsePreferences('not json')) === JSON.stringify(DEFAULT_PREFERENCES), 'nothing or damaged storage gives the defaults')
const p = parsePreferences(JSON.stringify({ newChatModel: 'google/gemini-3.5-flash', enterSends: 'mod', timeStyle: 'exact' }))
assert(p.newChatModel === 'google/gemini-3.5-flash' && p.enterSends === 'mod' && p.timeStyle === 'exact', 'a saved choice is read back')
const odd = parsePreferences(JSON.stringify({ newChatModel: 5, enterSends: 'tab', timeStyle: 'soon' }))
assert(odd.newChatModel === '' && odd.enterSends === 'enter' && odd.timeStyle === 'relative', 'values of the wrong kind fall back one by one')
assert(parsePreferences(JSON.stringify({ newChatModel: 'x'.repeat(201) })).newChatModel === '', 'a very long model name is ignored')
assert(parsePreferences(JSON.stringify({ timeStyle: 'exact' })).enterSends === 'enter', 'a partly saved record keeps the other defaults')

const now = new Date(2026, 10, 16, 15, 30)
assert(exactTime(new Date(2026, 10, 16, 14, 5).toISOString(), now) === '14:05', 'today shows the clock')
assert(exactTime(new Date(2026, 10, 15, 9, 7).toISOString(), now) === 'Yesterday 09:07', 'yesterday says so')
assert(exactTime(new Date(2026, 9, 3, 18, 0).toISOString(), now) === '3 Oct, 18:00', 'earlier this year shows day, month and time')
assert(exactTime(new Date(2025, 11, 25, 8, 0).toISOString(), now) === '25 Dec 2025', 'a previous year shows the year and no time')
assert(exactTime('garbage', now) === '' && exactTime(null, now) === '' && exactTime('', now) === '', 'a missing or bad date shows nothing')
