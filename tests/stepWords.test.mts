import { stepWords } from '../src/utils/stepWords'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

assert(stepWords('Create an issue', 'running').text === 'Creating an issue...', 'a running step is in the present tense with dots')
assert(stepWords('Create an issue', 'done').text === 'Created an issue', 'a finished step is in the past tense')
assert(stepWords('Create an issue', 'failed').text === 'Could not create an issue', 'a failed step says it could not')
assert(stepWords('List repository issues', 'done').text === 'Listed repository issues', 'list becomes listed')
assert(stepWords('Find a channel', 'done').text === 'Found a channel', 'irregular verbs are right (found)')
assert(stepWords('Send a message', 'done').text === 'Sent a message' && stepWords('Run a query', 'done').text === 'Ran a query', 'sent and ran')
assert(stepWords('Create an issue', 'running').icon === stepWords('Create an issue', 'done').icon && stepWords('Create an issue', 'done').icon === stepWords('Create an issue', 'failed').icon, 'the icon never changes as the step runs, finishes or fails')
assert(stepWords('Find a channel', 'done').icon === 'i-lucide-search' && stepWords('Create an issue', 'done').icon === 'i-lucide-plus' && stepWords('Delete a file', 'done').icon === 'i-lucide-trash-2' && stepWords('Execute a command', 'done').icon === 'i-lucide-terminal', 'the icon matches the kind of action')
assert(stepWords('Resolve library id', 'done').text === 'Resolve library id' && stepWords('Resolve library id', 'running').text === 'Resolve library id', 'a name that is not a known action is shown as it is, with a generic icon')
assert(stepWords('Resolve library id', 'done').icon === 'i-lucide-wrench', 'unknown actions get the generic tool icon')
assert(stepWords('List', 'done').text === 'Listed' && stepWords('', 'done').text === '', 'a single word or an empty name does not break')
