import type { NodeDefinition } from './workflowGraph'

export const NODE_CATEGORIES: Array<{ id: string, label: string, icon: string, nodes: NodeDefinition[] }> = [
  {
    id: 'triggers',
    label: 'Triggers',
    icon: 'i-lucide-zap',
    nodes: [
      { type: 'trigger', subtype: 'webhook', title: 'Webhook', subtitle: 'Catch hook', icon: 'i-lucide-webhook', color: 'text-amber-500' },
      { type: 'trigger', subtype: 'schedule', title: 'Schedule', subtitle: 'Runs on a timer', icon: 'i-lucide-clock', color: 'text-amber-500' },
      { type: 'trigger', subtype: 'manual', title: 'Manual', subtitle: 'Button click', icon: 'i-lucide-play-circle', color: 'text-amber-500' },
      { type: 'trigger', subtype: 'gmail', title: 'New Email', subtitle: 'Gmail', icon: 'i-logos-google-gmail', color: 'text-amber-500', comingSoon: true }
    ]
  },
  {
    id: 'ai-agents',
    label: 'AI Agents',
    icon: 'i-lucide-sparkles',
    nodes: [
      { type: 'agent', subtype: 'gemini', title: 'Gemini Agent', subtitle: 'Google AI', icon: 'i-lucide-bot', color: 'text-primary' },
      { type: 'agent', subtype: 'prompt-chain', title: 'Prompt Chain', subtitle: 'Multi-step', icon: 'i-lucide-link', color: 'text-primary' }
    ]
  },
  {
    id: 'logic',
    label: 'Logic & Flow',
    icon: 'i-lucide-git-branch',
    nodes: [
      { type: 'logic', subtype: 'if-else', title: 'If / Else', subtitle: 'Condition', icon: 'i-lucide-split', color: 'text-violet-500' },
      { type: 'logic', subtype: 'switch', title: 'Switch', subtitle: 'Router', icon: 'i-lucide-git-commit', color: 'text-violet-500' },
      { type: 'logic', subtype: 'loop', title: 'Loop', subtitle: 'For each item', icon: 'i-lucide-repeat', color: 'text-violet-500', config: { items: '', maxItems: 20, stopOnError: false, body: { kind: 'web-fetch', config: { url: '{{item}}' } } } },
      { type: 'logic', subtype: 'set', title: 'Set Fields', subtitle: 'Shape data', icon: 'i-lucide-braces', color: 'text-violet-500', config: { fields: [{ key: '', value: '', mode: 'text' }] } },
      { type: 'logic', subtype: 'code', title: 'JavaScript', subtitle: 'Run Code', icon: 'i-lucide-code-2', color: 'text-violet-500' }
    ]
  },
  {
    id: 'approval',
    label: 'Human in the Loop',
    icon: 'i-lucide-user-check',
    nodes: [
      {
        type: 'approval',
        subtype: 'review',
        title: 'Human Approval',
        subtitle: 'Review & sign-off',
        icon: 'i-lucide-shield-alert',
        color: 'text-amber-500',
        approverRole: 'Admin',
        approvalPrompt: 'Please review and approve the draft before dispatching to client.'
      }
    ]
  },
  {
    id: 'actions',
    label: 'Actions',
    icon: 'i-lucide-blocks',
    nodes: [
      { type: 'action', subtype: 'slack', title: 'Send Slack', subtitle: 'Message', icon: 'i-logos-slack-icon', color: 'text-emerald-500' },
      { type: 'action', subtype: 'google_drive', title: 'Save to Drive', subtitle: 'File', icon: 'i-logos-google-drive', color: 'text-emerald-500' },
      { type: 'action', subtype: 'api', title: 'HTTP Request', subtitle: 'Call an API', icon: 'i-lucide-globe', color: 'text-emerald-500', config: { method: 'GET', url: '', headers: [], body: '', timeoutSec: 15 } },
      { type: 'action', subtype: 'web-fetch', title: 'Read Web Page', subtitle: 'Page to text', icon: 'i-lucide-book-open-text', color: 'text-emerald-500', config: { url: '', maxChars: 8000 } },
      { type: 'action', subtype: 'visual-check', title: 'Visual Check', subtitle: 'Look at a page', icon: 'i-lucide-scan-eye', color: 'text-emerald-500', config: { url: '', requirements: '', previous: '', width: 1280, fullPage: false, colorScheme: 'light' } }
    ]
  }
]
