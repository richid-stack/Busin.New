import { tool } from 'ai'
import { z } from 'zod'
import { MCP_PRESETS } from '../../../shared/mcpCatalog'
import { resolveSetup, STATE_LABEL } from '../../services/capabilities/manifest'
import type { SetupSources } from '../../services/capabilities/manifest'
import { withToolLimits } from './limits'

/**
 * Before a job that needs apps, tool servers, skills or the person's computer, checks which of them are ready and
 * says what is missing and where to fix it. It reads only. It never connects or installs anything, and it never
 * reports something as connected unless it really is.
 */
export function createCheckSetupTool(userId: string, sources: Omit<SetupSources, 'presets'> & { presets?: SetupSources['presets'] }) {
  return tool({
    description: 'Check whether what a job needs is ready before you start: apps the user connects (Gmail, Slack, Notion...), tool servers, built-in skills, or their own computer. Pass each thing by name. It tells you what is ready, what the user still has to connect and where, and whether it can change things or only read. It connects nothing. Use it when a job depends on something that may not be set up, then tell the user in plain words what is ready and the one step for anything that is not.',
    inputSchema: z.object({
      needs: z.array(z.string().min(2).max(60)).min(1).max(8).describe('The things the job needs, by name, for example ["Gmail", "Google Sheets", "my computer"]')
    }),
    execute: withToolLimits(
      { name: 'check_setup', userId, perMinute: 15, timeoutMs: 20_000, maxResultChars: 6_000 },
      async ({ needs }) => {
        // The same thing asked for twice, in any capitalisation, is checked once.
        const unique = [...new Map(needs.map(n => n.trim()).filter(Boolean).map(n => [n.toLowerCase(), n] as const)).values()]
        const cards = await resolveSetup(unique, { presets: MCP_PRESETS, ...sources })
        const ready = cards.filter(c => c.state === 'ready').length
        return {
          status: 'ok' as const,
          summary: `${ready} of ${cards.length} ready`,
          ready,
          cards: cards.map(c => ({ ...c, stateLabel: STATE_LABEL[c.state] })),
          note: 'Tell the user in plain words which are ready and give the one step for each that is not, naming where it happens. Do not pretend anything is connected that is not, and do not ask for keys in chat.'
        }
      }
    )
  })
}
