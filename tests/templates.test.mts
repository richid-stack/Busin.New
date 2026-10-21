import { WORKFLOW_TEMPLATES, TEMPLATE_APPS, TEMPLATE_CATEGORIES, instantiateTemplate, templateFlow } from '../src/utils/workflowTemplates'
import { executeWorkflowDAG } from '../server/utils/workflowEngine'
import { nextRun } from '../server/services/schedule/cron'
import { loopCap } from '../server/utils/workflowNodes'
import type { NodeDeps } from '../server/utils/workflowNodes'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const MODEL = 'google/gemini-3.5-flash'

assert(WORKFLOW_TEMPLATES.length >= 7, 'the gallery has templates')
assert(new Set(WORKFLOW_TEMPLATES.map(t => t.id)).size === WORKFLOW_TEMPLATES.length, 'template ids are unique')

for (const t of WORKFLOW_TEMPLATES) {
  const label = `[${t.id}]`
  const { nodes, edges } = instantiateTemplate(t, { model: MODEL, timezone: 'Africa/Accra' })
  const ids = nodes.map(n => n.id)
  const byId = new Map(nodes.map(n => [n.id, n]))

  assert(t.title && t.description && t.setup && t.starts && TEMPLATE_CATEGORIES.includes(t.category), `${label} has its card text and a known category`)
  assert(t.apps.every(a => a in TEMPLATE_APPS), `${label} names only known apps`)
  assert(new Set(ids).size === ids.length && ids.every(id => /^[a-z][a-z0-9]*$/.test(id)), `${label} step ids are unique, letters and numbers only (formulas cannot read hyphens)`)
  assert(nodes.filter(n => n.type === 'trigger').length === 1 && nodes[0]!.type === 'trigger', `${label} has exactly one trigger, listed first`)
  assert(nodes.every(n => n.data.title && n.data.icon && Number.isFinite(n.position.x) && Number.isFinite(n.position.y)), `${label} every step has a title, icon and position`)
  assert(templateFlow(t).length === nodes.length, `${label} flow lists every step`)

  // Edges
  assert(edges.every(e => byId.has(e.source) && byId.has(e.target)), `${label} edges join existing steps`)
  assert(new Set(edges.map(e => e.id)).size === edges.length, `${label} edge ids are unique`)
  assert(edges.every(e => e.target !== 'trigger'), `${label} nothing connects into the trigger`)
  const handles = edges.filter(e => (e as any).sourceHandle)
  assert(handles.every(e => byId.get(e.source)!.data.subtype === 'if-else' && ['true', 'false'].includes((e as any).sourceHandle)), `${label} branch connections only leave If / Else steps`)
  assert(nodes.filter(n => n.data.subtype === 'if-else').every(n => edges.some(e => e.source === n.id && (e as any).sourceHandle)), `${label} every If / Else has a labelled way out`)

  // Reachable and acyclic
  const seen = new Set<string>(['trigger'])
  const queue = ['trigger']
  while (queue.length) { const from = queue.shift(); for (const e of edges.filter(x => x.source === from)) if (!seen.has(e.target)) { seen.add(e.target); queue.push(e.target) } }
  assert(ids.every(id => seen.has(id)), `${label} every step can be reached from the trigger`)
  const indegree = new Map(ids.map(id => [id, 0]))
  edges.forEach(e => indegree.set(e.target, indegree.get(e.target)! + 1))
  const ready = ids.filter(id => indegree.get(id) === 0)
  let visited = 0
  while (ready.length) { const id = ready.pop()!; visited++; for (const e of edges.filter(x => x.source === id)) { indegree.set(e.target, indegree.get(e.target)! - 1); if (indegree.get(e.target) === 0) ready.push(e.target) } }
  assert(visited === ids.length, `${label} has no cycle`)

  // Everything referenced exists
  const text = JSON.stringify(nodes.map(n => n.data))
  const names = [...text.matchAll(/\{\{\s*([A-Za-z0-9_-]+)/g)].map(m => m[1]!)
  const loopBody = (id: string) => nodes.some(n => n.data.subtype === 'loop' && JSON.stringify(n.data.config.body).includes(`{{${id}`))
  assert(names.every(name => byId.has(name) || (['item', 'index'].includes(name) && loopBody(name))), `${label} every {{placeholder}} points at a real step`)
  assert(!/hyphen|TODO|lorem/i.test(text), `${label} has no placeholder text left`)

  // Triggers and models
  const trigger = nodes[0]!
  assert(['manual', 'webhook', 'schedule'].includes(trigger.data.subtype), `${label} uses a trigger that works today`)
  if (trigger.data.subtype === 'schedule') {
    let okSchedule = true
    try { nextRun(trigger.data.schedule, new Date()) } catch { okSchedule = false }
    assert(okSchedule && trigger.data.schedule.timezone === 'Africa/Accra', `${label} schedule is valid, allowed and uses the user's time zone`)
  }
  assert(nodes.filter(n => n.type === 'agent').every(n => n.data.model === MODEL && n.data.prompt.length > 40), `${label} AI steps get the chosen model and real instructions`)
  assert(nodes.filter(n => n.data.subtype === 'loop').every(n => n.data.config.maxItems <= loopCap(n.data.config.body.kind, 999)), `${label} loops stay within the limits`)

  // Apps: every app a template says it needs is named in a step, and no step names an app it does not list
  const named = Object.keys(TEMPLATE_APPS).filter(p => nodes.some(n => n.type === 'agent' && n.data.subtitle === TEMPLATE_APPS[p]!.name))
  assert(named.sort().join() === [...t.apps].sort().join(), `${label} lists exactly the apps its steps use`)
}

// The templates are saved as a copy: changing one workflow never changes the template.
const a = instantiateTemplate(WORKFLOW_TEMPLATES[0]!, { model: MODEL })
a.nodes[1]!.data.config.fields[0].value = 'changed'
assert(JSON.stringify(WORKFLOW_TEMPLATES[0]!.nodes[1]!.data.config.fields[0].value) !== '"changed"', 'a saved workflow does not share data with its template')

// Run every template through the real engine with the AI steps swapped for a fixed answer.
const stub = (n: any) => n.type === 'agent' ? { id: n.id, type: 'logic', data: { title: n.data.title, subtype: 'set', config: { fields: [{ key: 'result', value: 'stub reply', mode: 'text' }] } } } : n
const reply = (status: number, body: unknown) => ({ status, url: 'https://example.com/', contentType: 'application/json', headers: {}, body: Buffer.from(JSON.stringify(body)), truncated: false })
const deps = (status = 200): NodeDeps => ({
  fetcher: (async () => reply(status, { ok: true })) as any,
  pageReader: async (url: string) => ({ url, title: 'Page', source: 'reader' as const, markdown: `Text of ${url}` })
})
const run = async (id: string, input: Record<string, any>, d: NodeDeps) => {
  const t = WORKFLOW_TEMPLATES.find(x => x.id === id)!
  const { nodes, edges } = instantiateTemplate(t, { model: MODEL })
  const wf = { id: 'w', title: t.title, userId: 'u', status: 'active', nodes: nodes.map(stub), edges, createdAt: new Date() } as any
  return executeWorkflowDAG(wf, input, 'u', { deps: { sleep: async () => {}, ...d } })
}
const ran = (r: any, id: string) => r.logs.some((l: any) => l.nodeId === id && l.status === 'completed')
const skipped = (r: any, id: string) => r.logs.some((l: any) => l.nodeId === id && l.status === 'skipped')

let r = await run('link-digest', {}, deps())
assert(r.status === 'completed' && r.outputs.pages.count === 2 && r.outputs.pages.succeeded === 2 && ran(r, 'digest'), 'link digest reads both starter links and finishes')

r = await run('competitor-snapshot', {}, deps())
assert(r.status === 'completed' && ran(r, 'page') && ran(r, 'email'), 'competitor snapshot reads the page and reaches the email step')

r = await run('uptime-check', {}, deps(200))
assert(r.status === 'completed' && skipped(r, 'alert') && !ran(r, 'alert'), 'uptime check stays quiet when the site answers')
r = await run('uptime-check', {}, deps(503))
assert(r.status === 'completed' && ran(r, 'alert'), 'uptime check alerts when the site keeps failing (server errors after retries)')
r = await run('uptime-check', {}, { fetcher: (async () => { throw new Error('connect ECONNREFUSED') }) as any })
assert(r.status === 'completed' && ran(r, 'alert') && r.outputs.check.failed === true, 'uptime check alerts when the site cannot be reached at all')

r = await run('inbox-digest', {}, deps())
assert(r.status === 'completed' && ran(r, 'post'), 'inbox digest runs both steps')

r = await run('lead-intake', { trigger: { body: { name: 'Ama', email: 'ama@example.com', message: 'Hello' } } }, deps())
assert(r.status === 'waiting_approval' && !ran(r, 'send'), 'a reply waits for approval before it is sent')

r = await run('hot-lead-router', { trigger: { body: { name: 'Ama', email: 'ama@example.com', budget: 5000 } } }, deps())
assert(r.status === 'completed' && ran(r, 'ping') && skipped(r, 'autoreply') && r.outputs.lead.budget === 5000, 'a big budget goes to Slack, not the auto-reply')
r = await run('hot-lead-router', { trigger: { body: { name: 'Kofi', email: 'k@example.com', budget: '200' } } }, deps())
assert(r.status === 'completed' && ran(r, 'autoreply') && skipped(r, 'ping'), 'a small budget (even sent as text) gets the auto-reply')
r = await run('hot-lead-router', { trigger: { body: { name: 'No budget' } } }, deps())
assert(r.status === 'completed' && r.outputs.lead.budget === 0 && ran(r, 'autoreply'), 'a missing budget counts as small')

r = await run('weekly-report', {}, deps())
assert(r.status === 'waiting_approval' && !ran(r, 'save'), 'the weekly report waits for approval before it is saved')
