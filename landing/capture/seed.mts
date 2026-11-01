/**
 * The sample content the capture server starts with. The person is "Ama Boateng", a small-business owner in Accra.
 * Everything here goes into the database through the app's own stores, so the pages read it exactly as they read a
 * real account. It is sample content and is only ever used to make pictures and films.
 */
const ME = 'ama'
const ago = (min: number) => new Date(Date.now() - min * 60_000)

export async function seed(vite: any, db: any) {
  const load = (p: string) => vite.ssrLoadModule(p) as Promise<any>
  const [{ createChat, saveChatMessages, createWorkflow }, agents, memory, tasksMod, reefMod, seedMod, { agentInputSchema }, tmpl, reg] = await Promise.all([
    load('/server/utils/firebase.ts'), load('/server/services/agents/store.ts'), load('/server/services/memory/store.ts'),
    load('/server/services/tasks/store.ts'), load('/server/services/reef/reef.ts'), load('/server/services/reef/seed.ts'),
    load('/server/services/agents/profile.ts'), load('/src/utils/workflowTemplates.ts'), load('/server/services/reef/seedRegistry.ts')
  ])

  // ---- Chats: the saved kind, with the traces the app writes down ----
  const chat = async (title: string, messages: any[], minutesAgo: number) => {
    const c = await createChat({ title, userId: ME })
    await db.collection('chats').doc(c.id).update({ updatedAt: ago(minutesAgo).toISOString(), createdAt: ago(minutesAgo + 3).toISOString() })
    await saveChatMessages(c.id, messages)
    return c.id
  }
  const user = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }] })
  const step = (label: string, detail = '') => ({ label, status: 'done', ...(detail ? { detail } : {}) })
  const appCall = (id: string, provider: string, instruction: string, steps: any[], summary: string) => ({
    type: 'tool-integration_execute', toolCallId: id, state: 'output-available',
    input: { provider, instruction },
    output: { success: true, provider, instruction, steps, output: { summary } }
  })

  const bugChat = await chat('File a bug', [
    user('m1', 'Create an issue in the Busin.New repo called "Login bug" and tell the team on Slack.'),
    { id: 'm2', role: 'assistant', parts: [
      { type: 'text', text: 'I can do both. Each one asks for your OK first.' },
      appCall('t1', 'github', 'Create an issue titled "Login bug" in richid-stack/Busin.New and label it bug.', [step('Listed repository issues', 'richid-stack/Busin.New'), step('Created an issue', 'Login bug'), step('Added labels to an issue')], 'Created issue #42 and labelled it bug.'),
      appCall('t2', 'slack', 'Tell the team in #team about the new issue.', [step('Found a channel', '#team'), step('Sent a message')], 'Posted in #team.'),
      { type: 'text', text: 'Done. Issue **#42 "Login bug"** is created and labelled `bug`, and the team has been told in #team.' }
    ] }
  ], 40)
  await chat('Invite the team', [
    user('a1', 'Send an invite for Friday 10am to the whole team about the stock count.'),
    { id: 'a2', role: 'assistant', parts: [
      { type: 'text', text: 'I will create the event and invite the team. It changes your calendar, so I need your OK first.' },
      { type: 'tool-integration_execute', toolCallId: 'ap1', state: 'approval-requested', input: { provider: 'google_calendar', instruction: 'Create an event "Stock count" on Friday at 10:00 and invite the whole team.' }, approval: { id: 'approval-1' } }
    ] }
  ], 15)
  await chat('Pricing page review', [user('p1', 'Look at our pricing page and tell me what is wrong with it.'), { id: 'p2', role: 'assistant', parts: [{ type: 'text', text: 'Three things stand out: the plan names do not match the checkout, the annual toggle is easy to miss, and the free plan hides its limits.' }] }], 120)
  await chat('Invoice for Akosua Ltd', [user('i1', 'Make an invoice for Akosua Ltd: 12 chairs at GH₵ 350 and delivery GH₵ 120.'), { id: 'i2', role: 'assistant', parts: [{ type: 'text', text: 'Subtotal GH₵ 4,320. I have created the invoice as a Word file.' }] }], 300)
  await chat('Weekly sales numbers', [user('w1', 'Chart my sales for the last six months: 12, 15, 14, 19, 23, 27 (in thousands).'), { id: 'w2', role: 'assistant', parts: [
    { type: 'text', text: 'Sales grew steadily, with the biggest jump in the last two months.' },
    { type: 'tool-chart', toolCallId: 'c1', state: 'output-available', input: {}, output: { title: 'Sales, last six months (GH₵ thousands)', xKey: 'month', data: [{ month: 'May', sales: 12 }, { month: 'Jun', sales: 15 }, { month: 'Jul', sales: 14 }, { month: 'Aug', sales: 19 }, { month: 'Sep', sales: 23 }, { month: 'Oct', sales: 27 }], series: [{ key: 'sales', name: 'Sales', color: '#3b82f6' }] } }
  ] }], 600)

  // ---- Agents ----
  for (const a of [
    { name: 'Inbox helper', description: 'Sorts the morning inbox and drafts replies you approve.', instructions: 'Go through unread email, group it into needs reply, FYI and ignore. Draft short replies in my voice and wait for my OK before sending anything.', tools: ['apps', 'web'], skills: ['inbox-triage', 'write-email'], maxSteps: 10 },
    { name: 'Research assistant', description: 'Finds sources, checks claims and writes a cited summary.', instructions: 'Search the web, read the sources, check each claim and cite where it came from. Say plainly what you could not verify.', tools: ['web', 'read_files'], skills: ['research', 'fact-check', 'summarize-document'], maxSteps: 12 },
    { name: 'Deck builder', description: 'Turns notes into a clear presentation storyline and a deck.', instructions: 'Ask who the audience is and what they should do afterwards. Write the storyline first, then build the slides.', tools: ['create_files', 'web'], skills: ['presentation-storyline'], maxSteps: 10 }
  ]) await agents.createAgent(ME, agentInputSchema.parse({ ...a, model: null }))

  // ---- Memory ----
  for (const t of ['I run a furniture shop in Accra called Akosua Interiors.', 'Invoices go out in Ghana cedis and customers pay by mobile money.', 'Keep replies short and friendly. No jargon.', 'My accountant is Kwame Osei. Send him month-end summaries.', 'The shop opens 8am to 6pm, Monday to Saturday.']) await memory.addMemory(ME, t, 'user')

  // ---- Workflows (the app's own ready-made ones, set up for this person) ----
  const model = 'google/gemini-2.5-flash'
  for (const id of ['link-digest', ...tmpl.WORKFLOW_TEMPLATES.map((t: any) => t.id).filter((x: string) => x !== 'link-digest').slice(0, 2)]) {
    const t = tmpl.getTemplate(id)
    if (!t) continue
    const { nodes, edges } = tmpl.instantiateTemplate(t, { model, timezone: 'Africa/Accra' })
    await createWorkflow({ title: t.title, description: t.description, status: 'active', nodes, edges, userId: ME })
  }

  // ---- Tasks: finished ones with honest checks ----
  const store = tasksMod.taskStore()
  const finish = async (goal: string, criteria: any[], result: string, status: 'done' | 'partial', ms: number) => {
    const t = await store.create(ME, { goal, criteria: criteria.map(c => ({ text: c.text, kind: c.kind })), tools: ['web', 'create_files', 'utilities'], model: null, maxAttempts: 2, maxSteps: 10, maxMinutes: 6 })
    const claimed = await store.claimNext()
    if (!claimed) return
    const checked = criteria.map((c, i) => ({ id: `c${i + 1}`, text: c.text, kind: c.kind, status: c.met === false ? 'unmet' : 'met', evidence: c.evidence }))
    await store.update(claimed.task.id, claimed.lease, { status: 'verifying', criteria: checked, attempts: 1, workedMs: ms })
    const doc = db.collection('tasks').doc(claimed.task.id)
    await doc.update({ startedAt: new Date(Date.now() - ms - 60_000).toISOString(), finishedAt: new Date(Date.now() - 60_000).toISOString() }).catch(() => {})
    await store.update(claimed.task.id, claimed.lease, { status, criteria: checked, result, attempts: 1, workedMs: ms, outcome: status === 'done' ? 'All checks passed.' : 'Most checks passed; one did not.' })
  }
  await finish('Compare the three best invoicing apps for a small shop in Ghana and write a one-page recommendation.', [
    { text: 'The recommendation is a one-page Word file', kind: 'file', evidence: 'invoicing-recommendation.docx, 1 page' },
    { text: 'Each app has its current price from its own website', kind: 'check', evidence: 'Prices read from three official pricing pages today.' }
  ], 'Recommended the simplest of the three, with prices and a short table.', 'done', 214_000)
  await finish('Read last quarter’s sales sheet and write three plain sentences about what changed.', [
    { text: 'Three sentences, no jargon', kind: 'check', evidence: 'Three sentences, reading level grade 7.' },
    { text: 'Every number matches the sheet', kind: 'check', evidence: 'All 5 figures matched rows in the sheet.' }
  ], 'Sales rose in two of three months; delivery costs rose fastest.', 'done', 96_000)
  await finish('Check that our pricing page loads cleanly on a phone and has a visible Buy button.', [
    { text: 'The page has no layout breaks on a 390px screen', kind: 'visual', evidence: 'Looked at the page at 390px wide.' },
    { text: 'A Buy button is visible without scrolling', kind: 'visual', evidence: 'The button sat below the first screen.', met: false }
  ], 'Page loads cleanly, but the Buy button is below the first screen on a phone.', 'partial', 142_000)

  // ---- A connected computer (sample): paired through the app's own pairing, and kept "online" while the capture server runs ----
  const bridgeMod = await load('/server/services/bridge/store.ts')
  const bridge = bridgeMod.bridgeStore()
  const pairing = await bridge.createPairing(ME)
  const { deviceId, token } = await bridge.redeemPairing(pairing.code, { name: 'Ama’s laptop', platform: 'windows', version: '0.5.0' })
  const device = await bridge.authenticate(token)
  await bridge.touch(device, { version: '0.5.0', capabilities: ['ping', 'browser_look', 'browser_session', 'workbook_list', 'workbook_inspect', 'workbook_apply'] })
  const keepAlive = () => db.collection('devices').doc(deviceId).update({ lastSeenAt: new Date().toISOString() }).catch(() => {})
  await keepAlive(); setInterval(keepAlive, 15_000).unref()

  // ---- The Reef: the official projects, plus a few people ----
  const reef = reefMod.createReef(db)
  await seedMod.runSeed({ profiles: reef.profiles, projects: reef.projects }, reg.officialSeeds())
  await reef.profiles.create(ME, { handle: 'ama', name: 'Ama Boateng', bio: 'Runs a furniture shop in Accra.', place: 'Accra' })
  const people = [
    ['kwesi', 'Kwesi Mensah', 'Builds agents for logistics teams.', 'Kumasi'],
    ['efua', 'Efua Tetteh', 'Accountant. Makes tax helpers for small shops.', 'Accra'],
    ['yaw_o', 'Yaw Owusu', 'Teaching myself automation, one workflow at a time.', 'Takoradi']
  ] as const
  for (const [handle, name, bio, place] of people) await reef.profiles.create(handle, { handle, name, bio, place })
  await reef.profiles.setBadges('kwesi', { verified: true })
  await reef.profiles.setBadges('efua', { verified: true })
  for (const who of ['kwesi', 'efua', 'yaw_o', ME]) for (const proj of ['writing-desk', 'research-analyst', 'data-analyst']) await reef.projects.star(who, 'openlobs', proj).catch(() => {})
  for (const who of ['kwesi', 'efua']) await reef.projects.star(who, 'openlobs', 'ghana-books-and-tax').catch(() => {})
  const p1 = await reef.posts.create('efua', { text: 'Added the Ghana books and tax agent to my shop assistant. It looks up the current VAT rule every time instead of guessing, which is exactly what I needed.', projectId: 'openlobs__ghana-books-and-tax' })
  await reef.posts.create('kwesi', { text: 'Made a dispatch helper from the writing desk project. Changed the instructions to plain language for drivers. Forks are open if you want it.' })
  const q = await reef.posts.ask('yaw_o', { title: 'How do I make a task wait for my OK before it sends an email?', text: 'I want the task to draft the email and stop. Where do I set that?', tags: ['tasks', 'approvals'] })
  const a = await reef.posts.reply('kwesi', q.id, { text: 'You do not need to set anything. Anything that sends, pays or deletes stops and asks first. Tick "Let it use a browser" only if the site has no connected app.' })
  await reef.posts.accept('yaw_o', a.id).catch(() => {})
  await reef.posts.like('ama', p1.id)
  await reef.posts.like('kwesi', p1.id)
}
