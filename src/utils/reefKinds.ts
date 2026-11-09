export type ProjectKind = 'agent' | 'workflow' | 'task' | 'pack'

/** How each kind of project looks. Only agents exist so far; workflows, tasks and packs follow. */
export const KINDS: Record<ProjectKind, { label: string, icon: string, dot: string, text: string }> = {
  agent: { label: 'Agent', icon: 'i-lucide-bot', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400' },
  workflow: { label: 'Workflow', icon: 'i-lucide-workflow', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  task: { label: 'Task', icon: 'i-lucide-list-checks', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  pack: { label: 'Pack', icon: 'i-lucide-package', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400' }
}

/** Icons for what a project needs, by tool group id. */
export const NEED_ICONS: Record<string, string> = {
  web: 'i-lucide-globe', read_files: 'i-lucide-file-search', create_files: 'i-lucide-file-plus', inspect: 'i-lucide-scan-eye', excel: 'i-lucide-table',
  utilities: 'i-lucide-wrench', memory: 'i-lucide-brain', apps: 'i-lucide-plug', workflows: 'i-lucide-workflow', mcp: 'i-lucide-server'
}
