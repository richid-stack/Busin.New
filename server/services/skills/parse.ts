import { parse as parseYaml } from 'yaml'

/** A skill is a folder with a SKILL.md: YAML frontmatter (name, description) followed by instructions. */
export interface Skill {
  name: string
  description: string
  /** The instructions the model follows after loading the skill. */
  body: string
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024
const MAX_BODY = 20_000

export class SkillError extends Error {}

/** Parses one SKILL.md. `folder` is the directory name, which must equal the skill's name. */
export function parseSkill(raw: string, folder: string): Skill {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) throw new SkillError(`${folder}: SKILL.md must start with a --- frontmatter block`)

  let meta: unknown
  try {
    meta = parseYaml(match[1]!)
  } catch (err: any) {
    throw new SkillError(`${folder}: frontmatter is not valid YAML (${err?.message})`)
  }
  if (!meta || typeof meta !== 'object') throw new SkillError(`${folder}: frontmatter is empty`)

  const { name, description } = meta as Record<string, unknown>
  if (typeof name !== 'string' || !NAME.test(name) || name.length > MAX_NAME) {
    throw new SkillError(`${folder}: "name" must be lowercase words joined by hyphens (max ${MAX_NAME} characters)`)
  }
  if (name !== folder) throw new SkillError(`${folder}: "name" (${name}) must match the folder name`)
  if (typeof description !== 'string' || !description.trim() || description.length > MAX_DESCRIPTION) {
    throw new SkillError(`${folder}: "description" is required (max ${MAX_DESCRIPTION} characters)`)
  }

  const body = match[2]!.trim()
  if (!body) throw new SkillError(`${folder}: the instructions are empty`)
  if (body.length > MAX_BODY) throw new SkillError(`${folder}: the instructions are longer than ${MAX_BODY} characters`)

  return { name, description: description.trim().replace(/\s+/g, ' '), body }
}

/**
 * Builds the catalog from `{ path: file text }`, where a path looks like ".../skills/<name>/SKILL.md".
 * A broken skill is skipped with a warning instead of taking the chat down.
 */
export function buildCatalog(files: Record<string, string>, warn: (message: string) => void = console.warn): Skill[] {
  const skills: Skill[] = []
  for (const [path, raw] of Object.entries(files)) {
    const folder = path.split('/').slice(-2, -1)[0] ?? path
    try {
      skills.push(parseSkill(raw, folder))
    } catch (err: any) {
      warn(`[skills] skipped: ${err?.message ?? err}`)
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** One line per skill, for the system prompt. */
export function describeCatalog(skills: Skill[]): string {
  return skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
}
