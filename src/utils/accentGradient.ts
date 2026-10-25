const GRADIENTS = [
  'bg-gradient-to-b from-blue-400/20 to-emerald-400/20 dark:from-blue-500/10 dark:to-emerald-500/10',
  'bg-gradient-to-b from-purple-400/20 to-pink-400/20 dark:from-purple-500/10 dark:to-pink-500/10',
  'bg-gradient-to-b from-amber-400/20 to-orange-400/20 dark:from-amber-500/10 dark:to-orange-500/10',
  'bg-gradient-to-b from-rose-400/20 to-red-400/20 dark:from-rose-500/10 dark:to-red-500/10'
]

/** The soft colour behind an app's cards. The same app always gets the same colour, in chat and on its own page. */
export function accentGradient(name: string): string {
  const hash = (name || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return GRADIENTS[hash % GRADIENTS.length]!
}
