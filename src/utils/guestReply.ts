export interface GuestReply {
  /** One line that speaks to what the visitor asked for. */
  opening: string
  /** What OpenLobs can do for them, in a few short items. */
  highlights: string[]
}

const TOPICS: Array<{ test: RegExp, reply: GuestReply }> = [
  {
    test: /\b(workflow|automat\w*|pipeline|trigger|schedule|every (day|week|morning)|whenever|when an?)\b/i,
    reply: {
      opening: 'Automations are what I do best, and I can build this one for you.',
      highlights: [
        'Draft the workflow on a visual canvas, ready to test and edit',
        'Connect it to Gmail, Slack, Drive, Notion, GitHub and many more',
        'Pause for your approval before anything important happens'
      ]
    }
  },
  {
    test: /\b(e-?mail|inbox|gmail|reply|draft|proposal|calendar|meeting|slack|drive|notion)\b/i,
    reply: {
      opening: 'I can work with your real inbox, calendar and files, not just talk about them.',
      highlights: [
        'Read, triage and draft replies in Gmail',
        'Save results to Drive, post to Slack, update Notion',
        'Everything runs on accounts only you have connected'
      ]
    }
  },
  {
    test: /\b(research|search|find|look up|latest|news|compare|summari[sz]e|website|competitor)\b/i,
    reply: {
      opening: 'Research is a good place to start: I can search the live web and read pages for you.',
      highlights: [
        'Search the web and cite where each answer came from',
        'Compare options and summarise long pages',
        'Turn the findings into a workflow you can rerun'
      ]
    }
  }
]

const GENERIC: GuestReply = {
  opening: 'I would love to help with that.',
  highlights: [
    'Answer questions and search the live web',
    'Build workflows that run across your apps',
    'Keep your chats and connected apps private to you'
  ]
}

/** Picks a warm, relevant reply without calling a model, so it costs nothing and cannot be abused. */
export function pickGuestReply(message: string): GuestReply {
  return TOPICS.find(topic => topic.test.test(message))?.reply ?? GENERIC
}

const PENDING_KEY = 'openlobs:pending-prompt'

/** Remembers what a visitor typed so it can be sent the moment they sign in. */
export function savePendingPrompt(text: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, text.slice(0, 2000))
  } catch { /* storage unavailable: the visitor can just retype */ }
}

export function takePendingPrompt(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY)
    if (value) sessionStorage.removeItem(PENDING_KEY)
    return value
  } catch {
    return null
  }
}
