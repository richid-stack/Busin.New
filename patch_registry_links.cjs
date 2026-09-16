const fs = require('fs')

const file = 'server/services/integrations/registry.ts'
let content = fs.readFileSync(file, 'utf8')

const linksCode = `
const AUTHENTIC_LINKS: Record<string, { website: string; privacy: string; terms: string }> = {
  'github': { website: 'https://github.com', privacy: 'https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement', terms: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service' },
  'microsoft_teams': { website: 'https://www.microsoft.com/en-us/microsoft-teams', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'outlook': { website: 'https://outlook.live.com', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'one_drive': { website: 'https://www.microsoft.com/en-us/microsoft-365/onedrive/online-cloud-storage', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'slack': { website: 'https://slack.com', privacy: 'https://slack.com/trust/privacy/privacy-policy', terms: 'https://slack.com/terms-of-service' },
  'gmail': { website: 'https://workspace.google.com/products/gmail/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_drive': { website: 'https://workspace.google.com/products/drive/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_calendar': { website: 'https://workspace.google.com/products/calendar/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_docs': { website: 'https://workspace.google.com/products/docs/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_sheets': { website: 'https://workspace.google.com/products/sheets/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_tasks': { website: 'https://workspace.google.com/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'notion': { website: 'https://notion.so', privacy: 'https://www.notion.so/privacy', terms: 'https://www.notion.so/terms' },
  'linear': { website: 'https://linear.app', privacy: 'https://linear.app/privacy', terms: 'https://linear.app/terms' },
  'jira': { website: 'https://www.atlassian.com/software/jira', privacy: 'https://www.atlassian.com/legal/privacy-policy', terms: 'https://www.atlassian.com/legal/cloud-terms-of-service' },
  'trello': { website: 'https://trello.com', privacy: 'https://www.atlassian.com/legal/privacy-policy', terms: 'https://www.atlassian.com/legal/cloud-terms-of-service' },
  'asana': { website: 'https://asana.com', privacy: 'https://asana.com/terms#privacy-policy', terms: 'https://asana.com/terms' },
  'salesforce': { website: 'https://www.salesforce.com', privacy: 'https://www.salesforce.com/company/privacy/', terms: 'https://www.salesforce.com/company/legal/agreements/' },
  'airtable': { website: 'https://airtable.com', privacy: 'https://airtable.com/privacy', terms: 'https://airtable.com/terms' },
  'zendesk': { website: 'https://www.zendesk.com', privacy: 'https://www.zendesk.com/company/agreements-and-terms/privacy-notice/', terms: 'https://www.zendesk.com/company/agreements-and-terms/master-subscription-agreement/' },
  'stripe': { website: 'https://stripe.com', privacy: 'https://stripe.com/privacy', terms: 'https://stripe.com/legal/end-users' },
  'excel': { website: 'https://www.microsoft.com/en-us/microsoft-365/excel', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'word': { website: 'https://www.microsoft.com/en-us/microsoft-365/word', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'powerpoint': { website: 'https://www.microsoft.com/en-us/microsoft-365/powerpoint', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'powerbi': { website: 'https://powerbi.microsoft.com', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'gitlab': { website: 'https://about.gitlab.com', privacy: 'https://about.gitlab.com/privacy/', terms: 'https://about.gitlab.com/terms/' },
  'hubspot': { website: 'https://www.hubspot.com', privacy: 'https://legal.hubspot.com/privacy-policy', terms: 'https://legal.hubspot.com/terms-of-service' },
  'clickup': { website: 'https://clickup.com', privacy: 'https://clickup.com/privacy', terms: 'https://clickup.com/terms' }
}
`

content = content.replace(
  "export async function getResolvedUserIntegrations",
  linksCode + "\nexport async function getResolvedUserIntegrations"
)

content = content.replace(
  "externalLinks: { website: 'https://example.com', privacy: 'https://example.com/privacy', terms: 'https://example.com/terms' },",
  "externalLinks: AUTHENTIC_LINKS[catalogItem.provider] || { website: 'https://example.com', privacy: 'https://example.com/privacy', terms: 'https://example.com/terms' },"
)

fs.writeFileSync(file, content)
