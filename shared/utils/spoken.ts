/**
 * Turning written answers into things worth saying out loud, and the other way: what a person said into a
 * yes or a no. Pure functions, used by the page and tested on their own.
 */

const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|approx|inc|ltd|co)|\b[A-Z])\.$/i

/** A key, token or other long unreadable string is never read out. */
const SECRET_LIKE = /\b(?:sk|pk|rk|ghp|gho|xox[bap]|AKIA|AIza|eyJ)[A-Za-z0-9_\-.]{12,}\b|\b[A-Za-z0-9_\-]{36,}\b/g

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu

const CURRENCIES: Array<[RegExp, string]> = [
  [/GH₵\s?([\d.,]+)/g, '$1 cedis'],
  [/GHS\s?([\d.,]+)/gi, '$1 cedis'],
  [/₦\s?([\d.,]+)/g, '$1 naira'],
  [/\$\s?([\d.,]+)/g, '$1 dollars'],
  [/€\s?([\d.,]+)/g, '$1 euros'],
  [/£\s?([\d.,]+)/g, '$1 pounds']
]

/** The same text as it would be spoken: no markup, code, tables, links, emoji or secrets. May be empty. */
export function spokenText(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n')
  t = t.replace(/```[\s\S]*?(?:```|$)/g, ' ')
  t = t.replace(/^\s*\|.*\|\s*$/gm, ' ')
  t = t.replace(/^\s*[-:| ]{3,}\s*$/gm, ' ')
  t = t.replace(/`([^`]*)`/g, '$1')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  t = t.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
  t = t.replace(/\bhttps?:\/\/\S+/gi, 'a link')
  t = t.replace(/\bwww\.\S+/gi, 'a link')
  t = t.replace(SECRET_LIKE, 'a secret value')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^\s*>+\s?/gm, '')
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
  t = t.replace(/(\*\*|__|\*|_|~~)/g, '')
  for (const [re, to] of CURRENCIES) t = t.replace(re, to)
  t = t.replace(/%/g, ' percent').replace(/&/g, ' and ')
  t = t.replace(EMOJI, '')
  t = t.replace(/[<>{}[\]\\|^]/g, ' ')
  t = t.replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\.(\s*\.)*/g, '.').replace(/([.!?])\s*\.\s/g, '$1 ').replace(/([:;,])\s*\.(?=\s|$)/g, '$1')
  return t.replace(/\s+/g, ' ').replace(/^[\s.,;:]+/, '').trim()
}

/**
 * The complete sentences in `text` after position `from`. A sentence is complete when something that ends
 * one is followed by a space (or the text is `final`, which also releases whatever is left). `next` is where
 * to carry on from. The text passed in is the written text; sentences come back already made speakable.
 */
export function takeSentences(text: string, from: number, final: boolean): { sentences: string[], next: number } {
  const out: string[] = []
  let start = from
  const re = /[.!?…]+["')\]]*(?=\s)|\n+/g
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // Inside a code block (still open, or not yet closed) nothing ends a sentence: the block is skipped as a whole.
    if ((text.slice(0, m.index).match(/```/g) || []).length % 2 === 1) continue
    const end = m.index + m[0].length
    const chunk = text.slice(start, end)
    // "Dr." or "e.g." do not end a sentence, and neither does "3." in a list that has more words after it.
    if (!m[0].includes('\n') && ABBREVIATIONS.test(chunk.trim())) continue
    const spoken = spokenText(chunk)
    if (spoken) out.push(spoken)
    start = end
  }
  if (final) {
    const spoken = spokenText(text.slice(start))
    if (spoken) out.push(spoken)
    start = text.length
  }
  return { sentences: out, next: start }
}

const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|alright|go ahead|go for it|do it|approve|approved|confirm|confirmed|send it|please do|correct|absolutely|definitely|that'?s fine|sounds good|proceed)\b/
/** "Don't send it" says no even though "send it" alone says yes. */
const NEGATED_YES = /\b(?:don'?t|do not|never|not)\s+(?:\w+\s+)?(?:send it|do it|go ahead|go for it|proceed|approve|confirm)\b/
const NO = /\b(no|nope|nah|don'?t|do not|stop|cancel|decline|deny|denied|hold on|wait|not yet|never ?mind|negative|reject)\b/

/**
 * What someone said to "shall I do this?". Only a clear yes or a clear no counts: anything long, mixed or
 * unclear is `null`, so Lobby asks again instead of guessing about something that changes things.
 */
export function yesOrNo(said: string): 'yes' | 'no' | null {
  const t = said.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.split(' ').length > 8) return null
  const negated = NEGATED_YES.test(t)
  const rest = t.replace(NEGATED_YES, ' ')
  const yes = YES.test(rest)
  const no = negated || NO.test(rest)
  if (yes === no) return null
  return yes ? 'yes' : 'no'
}
