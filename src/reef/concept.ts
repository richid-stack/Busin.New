/**
 * DESIGN CONCEPT ONLY. Sample people and projects so the look of The Reef can be judged before the
 * backend exists. Nothing here is real data. It is replaced by the API when the community is built.
 */
export type ProjectKind = 'agent' | 'workflow' | 'task' | 'pack'

export const KINDS: Record<ProjectKind, { label: string, icon: string, dot: string, text: string }> = {
  agent: { label: 'Agent', icon: 'i-lucide-bot', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400' },
  workflow: { label: 'Workflow', icon: 'i-lucide-workflow', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  task: { label: 'Task', icon: 'i-lucide-list-checks', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  pack: { label: 'Pack', icon: 'i-lucide-package', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400' }
}

export interface Person {
  handle: string
  name: string
  bio: string
  place: string
  verified?: boolean
  official?: boolean
  followers: number
  following: number
  joined: string
}

export const PEOPLE: Record<string, Person> = {
  ama: { handle: 'ama', name: 'Ama Boateng', bio: 'Runs a small shop in Madina. Building the assistant I wish I had on day one.', place: 'Accra, Ghana', verified: true, followers: 412, following: 96, joined: 'Sep 2026' },
  kwesi: { handle: 'kwesi', name: 'Kwesi Mensah', bio: 'Automations for small agencies. Workflows that save a Monday morning.', place: 'Kumasi, Ghana', verified: true, followers: 268, following: 140, joined: 'Sep 2026' },
  nanayaa: { handle: 'nanayaa', name: 'Nana Yaa Asare', bio: 'Accountant. VAT, payroll and the paperwork nobody enjoys.', place: 'Tema, Ghana', followers: 133, following: 61, joined: 'Oct 2026' },
  efua: { handle: 'efua', name: 'Efua Tetteh', bio: 'School administrator. Fees, notices, timetables.', place: 'Cape Coast, Ghana', followers: 57, following: 44, joined: 'Oct 2026' },
  yaw: { handle: 'yaw', name: 'Yaw Owusu', bio: 'Freelance developer. I make agents do the boring portal work.', place: 'Takoradi, Ghana', followers: 91, following: 72, joined: 'Oct 2026' },
  openlobs: { handle: 'openlobs', name: 'OpenLobs', bio: 'The team behind OpenLobs. Official starter projects and release notes.', place: 'Made in Ghana', verified: true, official: true, followers: 1204, following: 12, joined: 'Sep 2026' }
}

export interface Version { tag: string, title: string, when: string, latest?: boolean }
export interface FileRow { name: string, kind: 'dir' | 'file', note: string, when: string }

export interface Project {
  owner: string
  name: string
  kind: ProjectKind
  blurb: string
  tags: string[]
  stars: number
  forks: number
  questions: number
  uses: Array<{ app: string, icon: string }>
  /** What the project is made of, like a language bar. Shares add up to 100. */
  made: Array<{ label: string, pct: number, dot: string }>
  licence: string
  version: string
  updated: string
  safety: 'passed' | 'review'
  forkedFrom?: string
  files: FileRow[]
  versions: Version[]
  readme: Array<{ h?: string, p?: string, list?: string[], code?: string }>
}

const made = (agent: number, workflow: number, text: number) => [
  { label: 'Agent', pct: agent, dot: KINDS.agent.dot },
  { label: 'Workflow', pct: workflow, dot: KINDS.workflow.dot },
  { label: 'Instructions', pct: text, dot: 'bg-zinc-400' }
].filter(m => m.pct > 0)

export const PROJECTS: Project[] = [
  {
    owner: 'ama', name: 'shop-assistant', kind: 'agent', stars: 148, forks: 31, questions: 7, licence: 'MIT', version: 'v1.4', updated: '2 days ago', safety: 'passed',
    blurb: 'An assistant for a small shop: answers customer messages, keeps stock in a Google Sheet and reminds customers to pay on mobile money.',
    tags: ['retail', 'mobile-money', 'ghana', 'customer-care'],
    uses: [{ app: 'Gmail', icon: 'i-logos-google-gmail' }, { app: 'Google Sheets', icon: 'i-simple-icons:googlesheets' }, { app: 'Paystack', icon: 'i-lucide-wallet' }],
    made: made(45, 30, 25),
    files: [
      { name: 'workflows', kind: 'dir', note: 'Payment reminder before the due date', when: '2 days ago' },
      { name: 'skills', kind: 'dir', note: 'Add a stock check skill', when: '2 weeks ago' },
      { name: 'agent.json', kind: 'file', note: 'Allow Google Sheets, keep Gmail read-only', when: '2 days ago' },
      { name: 'instructions.md', kind: 'file', note: 'Reply in the customer\'s language, ask before any refund', when: '5 days ago' },
      { name: 'README.md', kind: 'file', note: 'Set-up steps for a new shop', when: '2 weeks ago' }
    ],
    versions: [
      { tag: 'v1.4', title: 'Remind on mobile money before the due date', when: '2 days ago', latest: true },
      { tag: 'v1.3', title: 'Stock check from a Google Sheet', when: '2 weeks ago' },
      { tag: 'v1.2', title: 'Replies in Twi when the customer writes in Twi', when: '1 month ago' }
    ],
    readme: [
      { h: 'Shop assistant', p: 'An assistant for a small shop. It answers customer messages, checks stock in a Google Sheet and nudges customers to pay on mobile money before the due date. It always asks before it refunds anything.' },
      { h: 'What it does' },
      { list: ['Answers common questions about price, stock and delivery', 'Looks up an item in your stock Sheet and says if it is in', 'Sends a polite payment reminder two days before a bill is due', 'Hands over to you when it is not sure, with the chat so far'] },
      { h: 'Set it up' },
      { list: ['Add it to your agents with the button above', 'Connect Gmail and Google Sheets from Integrations', 'Make a Sheet with the columns item, price and stock', 'Open the agent and point it at your Sheet'] },
      { h: 'Good to know' },
      { p: 'Anything that sends a message or changes your Sheet asks for your OK first. Nothing runs on its own until you turn the reminder workflow on.' }
    ]
  },
  {
    owner: 'kwesi', name: 'weekly-client-digest', kind: 'workflow', stars: 96, forks: 22, questions: 4, licence: 'MIT', version: 'v2.0', updated: '5 days ago', safety: 'passed',
    blurb: 'Every Monday at 8: reads last week\'s client emails, writes a short digest per client, saves it to Google Docs and posts it to Slack.',
    tags: ['agency', 'email', 'slack', 'weekly'],
    uses: [{ app: 'Gmail', icon: 'i-logos-google-gmail' }, { app: 'Google Docs', icon: 'i-simple-icons:googledocs' }, { app: 'Slack', icon: 'i-logos-slack-icon' }],
    made: made(0, 70, 30),
    files: [{ name: 'workflow.json', kind: 'file', note: 'Group the digest by client', when: '5 days ago' }, { name: 'prompts', kind: 'dir', note: 'Shorter summaries', when: '1 week ago' }, { name: 'README.md', kind: 'file', note: 'Add Slack set-up', when: '1 week ago' }],
    versions: [{ tag: 'v2.0', title: 'Group the digest by client', when: '5 days ago', latest: true }, { tag: 'v1.1', title: 'Post to Slack as well as Docs', when: '3 weeks ago' }],
    readme: [{ h: 'Weekly client digest', p: 'A workflow for agencies. It runs on a schedule, reads the week\'s emails from each client and writes one short digest per client.' }]
  },
  {
    owner: 'nanayaa', name: 'vat-return-prep', kind: 'pack', stars: 211, forks: 47, questions: 12, licence: 'CC BY 4.0', version: 'v0.9', updated: '1 week ago', safety: 'review',
    blurb: 'Prepares a monthly VAT return worksheet from your invoice Sheet. Looks up the current rate every time and cites where it came from.',
    tags: ['tax', 'accounting', 'ghana', 'monthly'],
    uses: [{ app: 'Google Sheets', icon: 'i-simple-icons:googlesheets' }, { app: 'Google Drive', icon: 'i-logos-google-drive' }],
    made: made(35, 35, 30),
    files: [{ name: 'agent.json', kind: 'file', note: 'Cite the source of every rate', when: '1 week ago' }, { name: 'workflows', kind: 'dir', note: 'Month-end worksheet', when: '1 week ago' }, { name: 'README.md', kind: 'file', note: 'Explain what to check by hand', when: '2 weeks ago' }],
    versions: [{ tag: 'v0.9', title: 'Month-end worksheet', when: '1 week ago', latest: true }],
    readme: [{ h: 'VAT return prep', p: 'Gets a return worksheet ready from your invoices. It never files anything: you check the numbers and file them yourself.' }]
  },
  {
    owner: 'yaw', name: 'portal-watcher', kind: 'task', stars: 64, forks: 9, questions: 3, licence: 'MIT', version: 'v1.1', updated: '3 days ago', safety: 'passed',
    blurb: 'Opens a portal that has no integration, signs in with your own session, checks one status page every morning and tells you if it changed.',
    tags: ['browser', 'portals', 'ghana', 'daily'],
    uses: [{ app: 'Browser', icon: 'i-lucide-globe' }, { app: 'Gmail', icon: 'i-logos-google-gmail' }],
    made: made(20, 50, 30),
    files: [{ name: 'task.json', kind: 'file', note: 'Check the page looks the same as last time', when: '3 days ago' }, { name: 'README.md', kind: 'file', note: 'How to sign in safely', when: '1 week ago' }],
    versions: [{ tag: 'v1.1', title: 'Check the page looks the same as last time', when: '3 days ago', latest: true }],
    readme: [{ h: 'Portal watcher', p: 'For the portals that have no integration. It opens the page in a browser on your own computer, reads one status, and emails you when it changes.' }]
  },
  {
    owner: 'efua', name: 'school-fees-reminder', kind: 'workflow', stars: 38, forks: 6, questions: 2, licence: 'MIT', version: 'v1.0', updated: '1 week ago', safety: 'passed',
    blurb: 'Reads the fees Sheet each Friday and drafts a polite reminder for each parent who is behind.',
    tags: ['school', 'fees', 'reminders'],
    uses: [{ app: 'Google Sheets', icon: 'i-simple-icons:googlesheets' }, { app: 'Gmail', icon: 'i-logos-google-gmail' }],
    made: made(0, 75, 25),
    files: [{ name: 'workflow.json', kind: 'file', note: 'First version', when: '1 week ago' }, { name: 'README.md', kind: 'file', note: 'First version', when: '1 week ago' }],
    versions: [{ tag: 'v1.0', title: 'First version', when: '1 week ago', latest: true }],
    readme: [{ h: 'School fees reminder', p: 'Every Friday it drafts a reminder for each parent who is behind. You read and send them yourself.' }]
  },
  {
    owner: 'openlobs', name: 'starter-pack', kind: 'pack', stars: 530, forks: 118, questions: 9, licence: 'MIT', version: 'v1.0', updated: '3 days ago', safety: 'passed',
    blurb: 'The official starter set: a research assistant, an inbox helper and a meeting-notes workflow. A good first thing to fork.',
    tags: ['official', 'starter'],
    uses: [{ app: 'Gmail', icon: 'i-logos-google-gmail' }, { app: 'Google Docs', icon: 'i-simple-icons:googledocs' }],
    made: made(50, 25, 25),
    files: [{ name: 'agents', kind: 'dir', note: 'Research assistant and inbox helper', when: '3 days ago' }, { name: 'workflows', kind: 'dir', note: 'Meeting notes', when: '3 days ago' }, { name: 'README.md', kind: 'file', note: 'First version', when: '3 days ago' }],
    versions: [{ tag: 'v1.0', title: 'First release', when: '3 days ago', latest: true }],
    readme: [{ h: 'Starter pack', p: 'Three things most people want first. Add them, change them, or fork the pack and make it yours.' }]
  }
]

export const project = (owner: string, name: string) => PROJECTS.find(p => p.owner === owner && p.name === name)

export interface Post {
  id: string
  by: string
  when: string
  text: string
  /** A project shown under the post. */
  project?: string
  replies: number
  reposts: number
  likes: number
  forkOf?: string
  question?: { answers: number, solved: boolean }
}

export const POSTS: Post[] = [
  { id: 'p1', by: 'ama', when: '2h', text: 'Shipped v1.4 of shop-assistant. It now reminds customers on mobile money two days before a bill is due. Forks welcome, tell me what breaks in your shop.', project: 'ama/shop-assistant', replies: 14, reposts: 22, likes: 163 },
  { id: 'p2', by: 'kwesi', when: '5h', text: 'Does anyone have a workflow that reads a Paystack webhook and adds a row to a Google Sheet? I have the Sheet side, stuck on the webhook.', replies: 6, reposts: 1, likes: 18, question: { answers: 3, solved: true } },
  { id: 'p3', by: 'nanayaa', when: '9h', text: 'Forked weekly-client-digest and turned it into a month-end review for my clients. Took an afternoon, most of it deciding what to leave out.', project: 'kwesi/weekly-client-digest', replies: 5, reposts: 4, likes: 71, forkOf: 'kwesi/weekly-client-digest' },
  { id: 'p4', by: 'openlobs', when: '1d', text: 'The Reef is open for reading. Share your first project: an agent, a workflow or a task. You choose the licence, we check it for keys and hidden tricks first.', replies: 31, reposts: 58, likes: 402 },
  { id: 'p5', by: 'yaw', when: '1d', text: 'Portals with no API are where agents earn their keep. portal-watcher opens one in a real browser on my own PC and emails me when the status changes. No more refreshing.', project: 'yaw/portal-watcher', replies: 19, reposts: 27, likes: 215 },
  { id: 'p6', by: 'efua', when: '2d', text: 'Our school fee reminders used to take me every Friday afternoon. Now I read the drafts and press send. Cost: nothing, on the free tier.', project: 'efua/school-fees-reminder', replies: 8, reposts: 6, likes: 94 }
]

export interface Question { id: string, title: string, by: string, when: string, tags: string[], answers: number, solved: boolean, project?: string }
export const QUESTIONS: Question[] = [
  { id: 'q1', title: 'Paystack webhook into a Google Sheet row: where does the trigger go?', by: 'kwesi', when: '5h ago', tags: ['paystack', 'webhooks', 'sheets'], answers: 3, solved: true },
  { id: 'q2', title: 'How do I stop shop-assistant from replying to messages that are not from customers?', by: 'efua', when: '1d ago', tags: ['shop-assistant', 'filters'], answers: 1, solved: false, project: 'ama/shop-assistant' },
  { id: 'q3', title: 'Is it safe to connect my business Gmail to an agent I forked?', by: 'yaw', when: '2d ago', tags: ['safety', 'gmail'], answers: 5, solved: true },
  { id: 'q4', title: 'Can a workflow wait for my approval on my phone before it sends?', by: 'nanayaa', when: '3d ago', tags: ['approvals', 'workflows'], answers: 0, solved: false },
  { id: 'q5', title: 'What is the best way to format cedis in a Sheet so the agent reads it right?', by: 'ama', when: '4d ago', tags: ['sheets', 'cedis'], answers: 2, solved: false }
]

export const TRENDING = ['ama/shop-assistant', 'yaw/portal-watcher', 'nanayaa/vat-return-prep']
export const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))
