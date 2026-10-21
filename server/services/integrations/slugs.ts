// The app uses readable provider ids (google_drive); Composio's Google toolkits use compact slugs.
const PROVIDER_TO_TOOLKIT: Record<string, string> = {
  gmail: 'gmail',
  google_drive: 'googledrive',
  google_calendar: 'googlecalendar',
  google_docs: 'googledocs',
  google_sheets: 'googlesheets',
  google_tasks: 'googletasks',
  google_slides: 'googleslides',
  google_meet: 'googlemeet'
}

const TOOLKIT_TO_PROVIDER = Object.fromEntries(Object.entries(PROVIDER_TO_TOOLKIT).map(([p, t]) => [t, p]))

export function composioToolkitSlug(provider: string): string {
  const normalized = provider.toLowerCase().trim()
  return PROVIDER_TO_TOOLKIT[normalized] ?? normalized
}

export function providerFromToolkitSlug(toolkit: string): string {
  const normalized = toolkit.toLowerCase().trim()
  return TOOLKIT_TO_PROVIDER[normalized] ?? normalized
}
