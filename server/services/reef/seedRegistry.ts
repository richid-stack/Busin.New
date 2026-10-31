/// <reference types="vite/client" />
import { skills } from '../skills/registry'
import { parseSeeds } from './seed'

// The seed folders are plain files in /reef-seed. The bundler inlines them at build time, like the skills,
// so nothing is read from disk at request time.
const files = import.meta.glob('../../../reef-seed/*/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** The official projects, checked against the skills this server has. A mistake in one stops the seed with a message that names it. */
export const officialSeeds = () => parseSeeds(files, new Set(skills.map(s => s.name)))
