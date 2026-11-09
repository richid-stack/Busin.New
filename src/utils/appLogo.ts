// Logos for the apps OpenLobs can act on, by the name the chat uses for them.
export const BRAND_ICON_MAP: Record<string, string> = {
  github: 'i-brand-github',
  gh: 'i-brand-github',
  slack: 'i-logos-slack-icon',
  discord: 'i-logos-discord-icon',
  linear: 'i-logos-linear-icon',
  notion: 'i-logos-notion-icon',
  jira: 'i-logos-jira',
  salesforce: 'i-logos-salesforce',
  airtable: 'i-logos-airtable',
  stripe: 'i-logos-stripe',
  gitlab: 'i-logos-gitlab',
  trello: 'i-logos-trello',
  asana: 'i-logos-asana-icon',
  gmail: 'i-logos-google-gmail',
  google_drive: 'i-logos-google-drive',
  drive: 'i-logos-google-drive',
  google_sheets: 'i-simple-icons:googlesheets',
  sheets: 'i-simple-icons:googlesheets',
  google_docs: 'i-simple-icons:googledocs',
  docs: 'i-simple-icons:googledocs',
  google_calendar: 'i-logos-google-calendar',
  calendar: 'i-logos-google-calendar',
  google_tasks: 'i-simple-icons:googletasks',
  tasks: 'i-simple-icons:googletasks',
  microsoft_teams: 'i-logos-microsoft-teams',
  teams: 'i-logos-microsoft-teams',
  outlook: 'i-logos-microsoft-icon',
  one_drive: 'i-logos-microsoft-onedrive',
  onedrive: 'i-logos-microsoft-onedrive',
  clickup: 'i-logos-clickup-icon',
  hubspot: 'i-logos-hubspot',
  canva: 'i-simple-icons:canva',
  figma: 'i-logos-figma',
  excel: 'i-simple-icons:microsoftexcel',
  word: 'i-simple-icons:microsoftword',
  powerpoint: 'i-simple-icons:microsoftpowerpoint',
  powerbi: 'i-logos-microsoft-power-bi',
  share_point: 'i-simple-icons:microsoftsharepoint',
  onenote: 'i-simple-icons:microsoftonenote',
  zendesk: 'i-logos-zendesk-icon'
}

/** The logo for an app name such as "github" or "google drive"; a plug when there is none. */
export function appLogo(name: string): string {
  return BRAND_ICON_MAP[name.toLowerCase().trim().replace(/[- ]/g, '_')] || 'i-lucide-plug'
}
