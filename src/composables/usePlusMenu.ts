import { computed } from 'vue'
import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useWorkspaces } from './useWorkspaces'
import { useAgents } from './useAgents'
import { useSkills } from './useSkills'

export type PlusMenuItem = DropdownMenuItem & { suffix?: string }

/**
 * The menu behind the round + button of a message box, the same on the home page and inside a chat:
 * files and web search, then which workspace, agent and skill this chat uses, then the places to set things up.
 * It only describes the menu; the page says what picking a workspace or an agent does (start a chat there, or move this one).
 */
export function usePlusMenu(o: {
  input: Ref<string>
  chooseFile: () => void
  workspaceId: Ref<string | null>
  agentId: Ref<string | null>
  pickWorkspace: (id: string | null) => void
  pickAgent: (id: string | null) => void
}) {
  const router = useRouter()
  const { workspaces, getWorkspace } = useWorkspaces()
  const { agents, getAgent } = useAgents()
  const { skills } = useSkills()

  const workspace = computed(() => getWorkspace(o.workspaceId.value))
  const agent = computed(() => getAgent(o.agentId.value))
  /** True when a workspace or an agent is on, so the + carries a small dot. */
  const active = computed(() => Boolean(workspace.value || agent.value))

  const items = computed<PlusMenuItem[][]>(() => [
    [
      { label: 'Upload files', icon: 'i-lucide-paperclip', onSelect: () => o.chooseFile() },
      { label: 'Search the web', icon: 'i-lucide-globe', onSelect: () => { o.input.value = 'Search the web for: ' } }
    ],
    [
      {
        label: 'Workspace',
        icon: 'i-lucide-folders',
        suffix: workspace.value?.name,
        children: [
          [
            { label: 'No workspace', icon: 'i-lucide-circle-slash', type: 'checkbox' as const, checked: !workspace.value, onUpdateChecked: () => o.pickWorkspace(null) },
            ...workspaces.value.map(w => ({ label: w.name, icon: w.id === o.workspaceId.value ? 'i-lucide-folder-open' : 'i-lucide-folder', type: 'checkbox' as const, checked: w.id === o.workspaceId.value, onUpdateChecked: () => o.pickWorkspace(w.id) }))
          ],
          [{ label: 'All workspaces', icon: 'i-lucide-arrow-up-right', onSelect: () => { router.push('/workspaces') } }]
        ]
      },
      {
        label: 'Agent',
        icon: 'i-lucide-bot',
        suffix: agent.value?.name,
        children: [[
          { label: 'Standard assistant', icon: 'i-lucide-message-circle', type: 'checkbox' as const, checked: !agent.value, onUpdateChecked: () => o.pickAgent(null) },
          ...agents.value.map(a => ({ label: a.name, icon: 'i-lucide-bot', type: 'checkbox' as const, checked: a.id === o.agentId.value, onUpdateChecked: () => o.pickAgent(a.id) }))
        ]]
      },
      {
        label: 'Skills',
        icon: 'i-lucide-scroll-text',
        children: [
          ...(skills.value.length ? [skills.value.map(s => ({ label: s.name, icon: 'i-lucide-scroll-text', onSelect: () => { o.input.value = `Use the ${s.name} skill: ` } }))] : []),
          [{ label: 'Manage skills', icon: 'i-lucide-arrow-up-right', onSelect: () => { router.push('/skills') } }]
        ]
      }
    ],
    [
      { label: 'Integrations', icon: 'i-lucide-blocks', onSelect: () => { router.push('/integrations') } },
      { label: 'Workflow Studio', icon: 'i-lucide-workflow', onSelect: () => { router.push('/workflows') } }
    ]
  ])

  return { items, active, workspace, agent }
}
