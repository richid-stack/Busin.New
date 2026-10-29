/**
 * Which of the voices built into a browser sounds best. Devices differ a lot: Edge ships natural "online" voices,
 * Chrome has Google voices, phones have good local ones, and some machines only have a flat default. This puts the
 * English voices first, the most natural-sounding at the top, so "best on this device" is a real choice.
 */
export interface VoiceLike { name: string, lang: string, voiceURI: string, default?: boolean }

const score = (v: VoiceLike): number => {
  let s = 0
  if (/natural|neural|online/i.test(v.name)) s += 40
  if (/google/i.test(v.name)) s += 25
  if (/^en[-_](GH|NG|KE|ZA|GB)/i.test(v.lang)) s += 15
  else if (/^en[-_]US/i.test(v.lang)) s += 10
  if (v.default) s += 3
  return s
}

/** English voices ranked best first. When the device has none, every voice it has, in its own order. */
export function rankBrowserVoices<T extends VoiceLike>(voices: T[]): T[] {
  const english = voices.filter(v => /^en([-_]|$)/i.test(v.lang))
  if (!english.length) return voices
  return english.map((v, i) => ({ v, i })).sort((a, b) => score(b.v) - score(a.v) || a.i - b.i).map(x => x.v)
}

/** The voice to use: the one the person picked if this device still has it, otherwise the best one. */
export function pickBrowserVoice<T extends VoiceLike>(voices: T[], chosenUri: string): T | undefined {
  return voices.find(v => v.voiceURI === chosenUri) ?? rankBrowserVoices(voices)[0]
}
