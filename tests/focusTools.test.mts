import { focusTools } from '../server/services/models/focus'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const all: Record<string, number> = Object.fromEntries(['calculator', 'weather', 'web_search', 'web_fetch', 'chart', 'plan', 'workflow_create', 'workflow_run', 'integration_status', 'integration_execute', 'create_document', 'edit_file', 'browser', 'mcp_x_do', 'remember', 'look_at_page'].map((n, i) => [n, i]))
const names = (provider: string | null, text: string) => Object.keys(focusTools(all, { provider, text }))

assert(names('google', 'hello').length === Object.keys(all).length, 'Gemini and other full-size models keep every tool')
assert(names(null, 'hello').length === Object.keys(all).length, 'an unknown provider keeps every tool')
assert(names('groq', 'hello there').join() === 'calculator,weather,web_search,web_fetch', 'a plain chat on Groq carries only the four everyday tools')
assert(['workflow_create', 'workflow_run', 'integration_status', 'integration_execute'].every(n => names('groq', 'Automate my inbox: when a client emails, save it to Drive').includes(n)), 'a workflow request brings the workflow tools')
assert(!names('groq', 'Automate my inbox').includes('create_document'), 'and not the file tools')
assert(names('groq', 'Write a Word proposal for Akosua').includes('create_document') && names('groq', 'Write a Word proposal for Akosua').includes('edit_file'), 'a file request brings the file tools')
assert(names('groq', 'plot my sales').includes('chart'), 'a chart request brings the chart tool')
assert(!names('groq', 'anything at all').some(n => n.startsWith('mcp_') || n === 'browser'), 'heavy tools never ride along uninvited')
assert(names('groq', 'remember that I like short answers').includes('remember'), 'memory tools appear when asked')

import { toolsUsedIn } from '../server/services/models/focus'
const withBuild: Record<string, number> = { ...all, ...Object.fromEntries(['list_files', 'read_file', 'search_files', 'write_file', 'edit_project_file', 'delete_file', 'create_page'].map((n, i) => [n, i])) }
const has = (text: string, used?: string[]) => Object.keys(focusTools(withBuild, { provider: 'groq', text, used }))
assert(has('Build me a tip calculator').includes('write_file') && has('Build me a tip calculator').includes('edit_project_file'), 'a build request brings the project tools')
assert(!has('hello there').includes('write_file'), 'a plain chat does not carry the project tools')
assert(has('make it 15 percent', ['write_file']).includes('edit_project_file'), 'a follow-up keeps the project tools once the chat has used one')
assert(!has('make it 15 percent').includes('edit_project_file'), 'and without that history it does not guess')
assert(toolsUsedIn([{ parts: [{ type: 'text' }, { type: 'tool-write_file' }] }, { parts: [{ type: 'tool-weather' }] }, {}]).join() === 'write_file,weather', 'tools used earlier are read from the messages')

const withPhotos: Record<string, number> = { ...all, fetch_file: 1, view_image: 2, find_photos: 3 }
const photoTools = (text: string) => Object.keys(focusTools(withPhotos, { provider: 'groq', text }))
assert(photoTools('Find photos of beaches').includes('find_photos') && photoTools('Get me a picture of Accra').includes('find_photos') && photoTools('save these images').includes('fetch_file'), 'photo, picture and image requests keep the photo tools, plural or not')
assert(!photoTools('hello there').includes('find_photos'), 'a plain chat does not carry the photo tools')
