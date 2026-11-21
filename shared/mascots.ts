/**
 * Mascots: the little faces that stand for an agent. Two families, on purpose:
 * - Creatures belong to OpenLobs' own built-in specialists. Nobody else can pick them.
 * - People (a lady or a man) are for the agents a person makes, or that OpenLobs makes for one task.
 * Plain data, shared by the browser and the server so both agree on what is valid.
 */
export const CREATURES = ['chameleon', 'hornbill', 'pangolin', 'galago', 'fennec', 'tortoise', 'sunbird', 'weaverbird', 'beetle', 'aardvark'] as const
export type CreatureId = typeof CREATURES[number]

export type HairStyle = 'puff' | 'braids' | 'wrap' | 'short' | 'locs' | 'fade'
export interface PersonMascot {
  id: string
  name: string
  /** Shown in the picker: "Lady" or "Man". */
  kind: 'lady' | 'man'
  skin: string
  hair: string
  cloth: string
  style: HairStyle
  glasses?: boolean
  beard?: boolean
  earrings?: boolean
  /** Colour of a head wrap or a collar stripe. */
  accent?: string
}

export const PEOPLE: PersonMascot[] = [
  { id: 'ama', name: 'Ama', kind: 'lady', skin: '#8B5A3C', hair: '#1d1612', cloth: '#3D5A80', style: 'puff', earrings: true },
  { id: 'efua', name: 'Efua', kind: 'lady', skin: '#6A4229', hair: '#17110d', cloth: '#7A8B5A', style: 'braids' },
  { id: 'abena', name: 'Abena', kind: 'lady', skin: '#A56E48', hair: '#17110d', cloth: '#2F3B4A', style: 'wrap', accent: '#D9A441', earrings: true },
  { id: 'adwoa', name: 'Adwoa', kind: 'lady', skin: '#5B3925', hair: '#120d0a', cloth: '#B5654A', style: 'short', glasses: true },
  { id: 'kwame', name: 'Kwame', kind: 'man', skin: '#7A4B30', hair: '#14100d', cloth: '#4A5A6A', style: 'short', glasses: true },
  { id: 'kofi', name: 'Kofi', kind: 'man', skin: '#5E3B27', hair: '#100c09', cloth: '#6B7F5E', style: 'fade', beard: true },
  { id: 'kojo', name: 'Kojo', kind: 'man', skin: '#9A6642', hair: '#1a130f', cloth: '#8A6A3F', style: 'locs' },
  { id: 'yaw', name: 'Yaw', kind: 'man', skin: '#6F452D', hair: '#120d0a', cloth: '#3B4350', style: 'fade', accent: '#C9A24A' }
]
export const PERSON_IDS = PEOPLE.map(p => p.id)

export function isPersonId(value: unknown): value is string {
  return typeof value === 'string' && PERSON_IDS.includes(value)
}
export function isCreatureId(value: unknown): value is CreatureId {
  return typeof value === 'string' && (CREATURES as readonly string[]).includes(value)
}
export function personById(id: unknown): PersonMascot | null {
  return PEOPLE.find(p => p.id === id) ?? null
}
/** The person for an agent: the one it was given, or the one its name picks (older agents were saved without one). */
export function mascotFor(agent: { mascot?: string | null, name: string }): string {
  return isPersonId(agent.mascot) ? agent.mascot : defaultPersonFor(agent.name)
}
/** The same name always gets the same person, so an agent with no pick still looks the same everywhere. */
export function defaultPersonFor(name: string): string {
  const hash = (name || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return PEOPLE[hash % PEOPLE.length]!.id
}
