/// <reference types="vite/client" />
import { buildCatalog } from './parse'

// Skills are plain files in /skills. The bundler inlines them at build time, so they ship with the
// server and nothing is read from disk at request time.
const files = import.meta.glob('../../../skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const skills = buildCatalog(files)

export const findSkill = (name: string) => skills.find(s => s.name === name)
