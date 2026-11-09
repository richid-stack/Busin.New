/**
 * Turns the name of an action ("Create an issue") into words that read like someone narrating it
 * ("Creating an issue...", "Created an issue", "Could not create an issue"), and picks an icon for the
 * kind of action. The icon never changes while the step runs; the words carry the progress.
 */
interface Verb { ing: string, past: string, icon: string }

const VERBS: Record<string, Verb> = {
  find: { ing: 'Finding', past: 'Found', icon: 'i-lucide-search' },
  search: { ing: 'Searching for', past: 'Searched for', icon: 'i-lucide-search' },
  query: { ing: 'Searching', past: 'Searched', icon: 'i-lucide-search' },
  lookup: { ing: 'Looking up', past: 'Looked up', icon: 'i-lucide-search' },
  list: { ing: 'Listing', past: 'Listed', icon: 'i-lucide-list' },
  get: { ing: 'Looking up', past: 'Looked up', icon: 'i-lucide-file-search' },
  fetch: { ing: 'Fetching', past: 'Fetched', icon: 'i-lucide-file-search' },
  retrieve: { ing: 'Retrieving', past: 'Retrieved', icon: 'i-lucide-file-search' },
  read: { ing: 'Reading', past: 'Read', icon: 'i-lucide-file-text' },
  view: { ing: 'Viewing', past: 'Viewed', icon: 'i-lucide-eye' },
  create: { ing: 'Creating', past: 'Created', icon: 'i-lucide-plus' },
  add: { ing: 'Adding', past: 'Added', icon: 'i-lucide-plus' },
  append: { ing: 'Adding to', past: 'Added to', icon: 'i-lucide-plus' },
  insert: { ing: 'Inserting', past: 'Inserted', icon: 'i-lucide-plus' },
  update: { ing: 'Updating', past: 'Updated', icon: 'i-lucide-pencil' },
  edit: { ing: 'Editing', past: 'Edited', icon: 'i-lucide-pencil' },
  modify: { ing: 'Changing', past: 'Changed', icon: 'i-lucide-pencil' },
  set: { ing: 'Setting', past: 'Set', icon: 'i-lucide-pencil' },
  rename: { ing: 'Renaming', past: 'Renamed', icon: 'i-lucide-pencil' },
  delete: { ing: 'Deleting', past: 'Deleted', icon: 'i-lucide-trash-2' },
  remove: { ing: 'Removing', past: 'Removed', icon: 'i-lucide-trash-2' },
  archive: { ing: 'Archiving', past: 'Archived', icon: 'i-lucide-archive' },
  send: { ing: 'Sending', past: 'Sent', icon: 'i-lucide-send' },
  post: { ing: 'Posting', past: 'Posted', icon: 'i-lucide-send' },
  reply: { ing: 'Replying to', past: 'Replied to', icon: 'i-lucide-reply' },
  comment: { ing: 'Commenting on', past: 'Commented on', icon: 'i-lucide-message-square' },
  publish: { ing: 'Publishing', past: 'Published', icon: 'i-lucide-send' },
  upload: { ing: 'Uploading', past: 'Uploaded', icon: 'i-lucide-upload' },
  download: { ing: 'Downloading', past: 'Downloaded', icon: 'i-lucide-download' },
  export: { ing: 'Exporting', past: 'Exported', icon: 'i-lucide-download' },
  import: { ing: 'Importing', past: 'Imported', icon: 'i-lucide-upload' },
  move: { ing: 'Moving', past: 'Moved', icon: 'i-lucide-move-right' },
  copy: { ing: 'Copying', past: 'Copied', icon: 'i-lucide-copy' },
  share: { ing: 'Sharing', past: 'Shared', icon: 'i-lucide-share-2' },
  merge: { ing: 'Merging', past: 'Merged', icon: 'i-lucide-git-merge' },
  close: { ing: 'Closing', past: 'Closed', icon: 'i-lucide-circle-check' },
  open: { ing: 'Opening', past: 'Opened', icon: 'i-lucide-folder-open' },
  assign: { ing: 'Assigning', past: 'Assigned', icon: 'i-lucide-user-check' },
  invite: { ing: 'Inviting', past: 'Invited', icon: 'i-lucide-user-plus' },
  label: { ing: 'Labelling', past: 'Labelled', icon: 'i-lucide-tag' },
  tag: { ing: 'Tagging', past: 'Tagged', icon: 'i-lucide-tag' },
  run: { ing: 'Running', past: 'Ran', icon: 'i-lucide-terminal' },
  execute: { ing: 'Running', past: 'Ran', icon: 'i-lucide-terminal' },
  trigger: { ing: 'Starting', past: 'Started', icon: 'i-lucide-play' },
  schedule: { ing: 'Scheduling', past: 'Scheduled', icon: 'i-lucide-calendar-clock' },
  generate: { ing: 'Generating', past: 'Generated', icon: 'i-lucide-sparkles' },
  convert: { ing: 'Converting', past: 'Converted', icon: 'i-lucide-refresh-cw' },
  approve: { ing: 'Approving', past: 'Approved', icon: 'i-lucide-circle-check' },
  summarize: { ing: 'Summarising', past: 'Summarised', icon: 'i-lucide-text' }
}

export interface StepWords { text: string, icon: string }

/** The words and icon for one step. Names that do not start with a known action are shown as they are. */
export function stepWords(label: string, status: 'running' | 'done' | 'failed'): StepWords {
  const trimmed = label.trim()
  const [first = '', ...rest] = trimmed.split(/\s+/)
  const verb = VERBS[first.toLowerCase()]
  if (!verb) return { text: trimmed, icon: 'i-lucide-wrench' }
  const tail = rest.join(' ')
  const join = (head: string) => (tail ? `${head} ${tail}` : head)
  if (status === 'running') return { text: `${join(verb.ing)}...`, icon: verb.icon }
  if (status === 'failed') return { text: `Could not ${join(first.toLowerCase())}`, icon: verb.icon }
  return { text: join(verb.past), icon: verb.icon }
}
