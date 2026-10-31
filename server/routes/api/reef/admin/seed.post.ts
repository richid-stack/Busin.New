import { reefHandler, WRITE } from '../../../../utils/reefRoute'
import { runSeed, SeedError } from '../../../../services/reef/seed'
import { officialSeeds } from '../../../../services/reef/seedRegistry'
import { ReefError } from '../../../../services/reef/model'

/**
 * Publishes (or brings up to date) the ready-made projects under the official account. Only the people in REEF_ADMINS.
 * Safe to press again: what has not changed is left alone.
 */
export default reefHandler({ auth: 'admin', limit: WRITE('reef-seed', 6, 10 * 60_000) }, async ({ reef }) => {
  let seeds
  try { seeds = officialSeeds() } catch (err) { throw new ReefError(err instanceof SeedError ? err.message : 'The ready-made projects could not be read.') }
  try {
    return { results: await runSeed({ profiles: reef.profiles, projects: reef.projects }, seeds) }
  } catch (err) {
    if (err instanceof SeedError) throw new ReefError(err.message, 'conflict')
    throw err
  }
})
