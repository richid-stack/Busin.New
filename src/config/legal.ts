/** One place for the facts the legal pages state, so they stay true when something changes. */
export const LEGAL = {
  product: 'OpenLobs',
  company: 'Mensah Labs',
  country: 'Ghana',
  /** Set VITE_CONTACT_EMAIL when deploying. Without it the pages tell people to use the contact details on the website. */
  contactEmail: (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || '',
  updated: '20 October 2026',
  /** Days a created file is kept (server/services/files/store.ts). */
  fileRetentionDays: 30
} as const
