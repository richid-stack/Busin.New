import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { composioToolkitSlug, providerFromToolkitSlug } from '../server/services/integrations/slugs'
import { ALL_INTEGRATIONS_CATALOG, executeIntegratedAction, getResolvedUserIntegrations } from '../server/services/integrations/registry'

const assert = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

assert(composioToolkitSlug('google_drive') === 'googledrive' && composioToolkitSlug('slack') === 'slack', 'provider -> toolkit slug')
assert(providerFromToolkitSlug('googlecalendar') === 'google_calendar' && providerFromToolkitSlug('github') === 'github', 'toolkit slug -> provider')
assert(new Set(ALL_INTEGRATIONS_CATALOG.map(i => i.provider)).size === ALL_INTEGRATIONS_CATALOG.length, 'catalog provider ids are unique')

useFirebaseDbForTests(createFakeFirestore() as any)
delete process.env.COMPOSIO_API_KEY
const list = await getResolvedUserIntegrations('u1')
assert(list.length === ALL_INTEGRATIONS_CATALOG.length && list.every(i => i.status === 'disconnected') && list.filter(i => i.type !== 'custom').every(i => !i.canConnect) && list.filter(i => i.type === 'custom').every(i => i.canConnect), 'nothing is shown as connected, and app connecting is disabled without Composio (key-based connectors still work)')

for (const provider of ['gmail', 'google_drive', 'slack', 'notion']) {
  const res = await executeIntegratedAction('u1', provider, `${provider}_action`, { instruction: 'x' })
  assert(res.success === false && res.output === null, `${provider}: no simulated success when Composio is not configured`)
}
const unknown = await executeIntegratedAction('u1', 'nope', 'x', {})
assert(unknown.success === false, 'unknown provider fails')
