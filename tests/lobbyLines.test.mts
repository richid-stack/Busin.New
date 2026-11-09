import { LINE_CAP, REST_ON_SCREEN, lobbyParts, newFeedState, newLines, primeFeed, approvalQuestion, phraseFor } from '../src/utils/lobbyLines'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const user = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const asst = (id: string, parts: any[]) => ({ id, role: 'assistant', parts })
const text = (t: string, state = 'streaming') => ({ type: 'text', text: t, state })
const tool = (name: string, state: string, extra: any = {}) => ({ type: `tool-${name}`, state, input: {}, ...extra })

// Sentences come out as they complete, once each.
let state = newFeedState()
let msgs: any[] = [user('u1', 'hi'), asst('a1', [text('Let me check your invoices. Found thr')])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Let me check your invoices.', 'a finished sentence is said while the next is still arriving')
msgs = [user('u1', 'hi'), asst('a1', [text('Let me check your invoices. Found three. Two are overdue')])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Found three.', 'only the new sentence is said')
assert(newLines(lobbyParts(msgs), state, false).length === 0, 'nothing is said twice')
assert(newLines(lobbyParts(msgs), state, true).join('|') === 'Two are overdue', 'when the answer is over the last piece is said too')

// An action started without a word of narration gets a phrase; one that was announced does not.
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [tool('web_search', 'input-available')])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Searching the web.', 'a silent action is announced')
assert(newLines(lobbyParts(msgs), state, false).length === 0, 'the phrase is said once')
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [text('Let me search for that. ', 'done'), tool('web_search', 'input-available')])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Let me search for that.', 'an action the assistant already announced is not announced again')

// Approvals.
const ask = tool('integration_execute', 'approval-requested', { input: { provider: 'github', instruction: 'Create an issue called "Fix login".' }, approval: { id: 'ap1' } })
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [ask])]
const q = newLines(lobbyParts(msgs), state, false)
assert(q.length === 1 && /GitHub/.test(q[0]!) && /Shall I go ahead\?$/.test(q[0]!), 'a decision is put as a question')
assert(lobbyParts(msgs)[0]!.approvalId === 'ap1' && lobbyParts(msgs)[0]!.kind === 'approval', 'the approval to answer is found')
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [text('Shall I create the issue?', 'done'), ask])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Shall I create the issue?', 'a question already asked in words is not asked twice')
assert(/run send email/.test(approvalQuestion(tool('send_email', 'approval-requested'))), 'other tools are named in plain words')

// The same action first starts, then asks for approval: the question is still asked.
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [text('Found three. ', 'done'), tool('integration_execute', 'input-available', { input: { provider: 'gmail', instruction: 'Send reminders.' } })])]
assert(newLines(lobbyParts(msgs), state, false).join('|') === 'Found three.', 'a running action that was announced stays quiet')
msgs = [user('u1', 'x'), asst('a1', [text('Found three. ', 'done'), { ...ask }])]
assert(/Shall I go ahead\?$/.test(newLines(lobbyParts(msgs), state, false).join('|')), 'when it then needs approval, the question is asked')

// Long writing is capped, and the screen is pointed to once.
state = newFeedState()
const long = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1} of a long answer.`).join(' ')
msgs = [user('u1', 'x'), asst('a1', [text(long, 'done')])]
const spoken = newLines(lobbyParts(msgs), state, true)
assert(spoken.at(-1) === REST_ON_SCREEN && spoken.filter(l => l === REST_ON_SCREEN).length === 1, 'a long answer ends with "the rest is on your screen", once')
assert(spoken.slice(0, -1).join(' ').length < LINE_CAP + 60, 'only a few hundred characters are read out')

// Only the current answer, and old chats stay quiet.
msgs = [user('u1', 'x'), asst('a1', [text('Old answer. ', 'done')]), user('u2', 'y'), asst('a2', [text('New answer. ', 'done')])]
assert(lobbyParts(msgs).length === 1 && lobbyParts(msgs)[0]!.key === 'a2:0', 'only what came after the latest question counts')
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [text('Earlier answer. ', 'done')])]
primeFeed(lobbyParts(msgs), state)
assert(newLines(lobbyParts(msgs), state, true).length === 0, 'opening Lobby on an old chat does not read it out')
assert(newLines(lobbyParts([...msgs, user('u2', 'more'), asst('a2', [text('Fresh. ', 'done')])] as any), state, true).join('|') === 'Fresh.', 'but the next answer is read')

// Thinking is never read out, and code is never read.
state = newFeedState()
msgs = [user('u1', 'x'), asst('a1', [{ type: 'reasoning', text: 'secret thoughts.', state: 'done' }, text('Here you go.\n```js\nx()\n```\nDone. ', 'done')])]
assert(newLines(lobbyParts(msgs), state, true).join('|') === 'Here you go.|Done.', 'reasoning and code stay silent')
assert(phraseFor(tool('integration_execute', 'input-available', { input: { provider: 'google_calendar' } })) === 'Working in Google Calendar.', 'apps are named properly')
console.log(process.exitCode ? 'Lobby line tests FAILED' : 'Lobby line tests OK')
