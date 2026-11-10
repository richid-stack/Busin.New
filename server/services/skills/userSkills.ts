import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { assertNotDeleting } from '../account/tombstone'
import type { Skill } from './parse'

const COLLECTION = 'user_skills'

export const USER_SKILL_LIMITS = { maxPerUser: 10 }

/** A skill the person chose to keep. It came from outside, so it is always shown with where it came from. */
export interface InstalledSkill extends Skill {
  userId: string
  /** owner/name of the project, plus the folder when there is one. */
  source: string
  /** What the safety check noted (it never keeps a skill it blocked). */
  warnings: string[]
  installedAt: string
}

export class SkillConflict extends Error {}

const docId = (userId: string, name: string) => `${userId}__${name}`.replaceAll('/', '~')

function fromDoc(data: Record<string, any>): InstalledSkill {
  return {
    userId: String(data.userId || ''),
    name: String(data.name || ''),
    description: String(data.description || ''),
    body: String(data.body || ''),
    source: String(data.source || ''),
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String).slice(0, 5) : [],
    installedAt: String(data.installedAt || '')
  }
}

export async function listInstalledSkills(userId: string): Promise<InstalledSkill[]> {
  const snap = await getFirebaseDb().collection(COLLECTION).where('userId', '==', userId).get()
  return snap.docs.map(d => fromDoc(d.data())).filter(s => s.name && s.body).sort((a, b) => a.installedAt.localeCompare(b.installedAt))
}

/**
 * Keeps a skill for the person. The count and the write are one transaction, so simultaneous requests cannot all pass
 * against the same count. A skill with the same name as a built-in one, or one already kept, is refused.
 */
export async function installSkill(userId: string, input: { skill: Skill, source: string, warnings: string[] }, builtIn: string[]): Promise<InstalledSkill> {
  await assertNotDeleting(userId)
  const { skill } = input
  if (builtIn.includes(skill.name)) throw new SkillConflict(`OpenLobs already has a built-in skill called ${skill.name}.`)
  const db = getFirebaseDb()
  const ref = db.collection(COLLECTION).doc(docId(userId, skill.name))
  const doc = { userId, name: skill.name, description: skill.description, body: skill.body, source: input.source, warnings: input.warnings.slice(0, 5), installedAt: new Date().toISOString() }
  await db.runTransaction(async (tx) => {
    const mine = await tx.get(db.collection(COLLECTION).where('userId', '==', userId))
    if (mine.docs.some(d => d.id === ref.id)) throw new SkillConflict(`You already have a skill called ${skill.name}.`)
    if (mine.docs.length >= USER_SKILL_LIMITS.maxPerUser) throw new SkillConflict(`You can keep up to ${USER_SKILL_LIMITS.maxPerUser} skills of your own. Remove one to add another.`)
    tx.set(ref, doc)
  })
  return fromDoc(doc)
}

/** Removes one of the person's kept skills. Returns false when there was none by that name. */
export async function removeInstalledSkill(userId: string, name: string): Promise<boolean> {
  const ref = getFirebaseDb().collection(COLLECTION).doc(docId(userId, name))
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.userId !== userId) return false
  await ref.delete()
  return true
}

/**
 * What the model is told about a kept skill: a skill's description is written by a stranger and goes into the prompt,
 * so it is flattened to one short line and marked with the project it came from.
 */
export function installedAsSkill(s: InstalledSkill): Skill {
  // Only the owner and project name go in, as GitHub itself limits them to letters, digits, dots, dashes and underscores.
  // The folder inside the project is chosen by whoever wrote the skill, so it never reaches the prompt.
  const project = s.source.split('/').slice(0, 2).join('/')
  const from = /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(project) ? `, from ${project}` : ''
  return { name: s.name, description: `${s.description.replace(/\s+/g, ' ').slice(0, 160)} (kept by the user${from})`, body: s.body }
}
