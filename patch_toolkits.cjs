const fs = require('fs');

const toolkitsList = `
export const POPULAR_COMPOSIO_TOOLKITS: SupportedThirdPartyToolkit[] = [
  {
    slug: 'slack',
    name: 'Slack',
    icon: 'i-logos-slack-icon',
    description: 'Post channel notifications, send direct messages, and listen for incoming mentions.',
    category: 'communication',
    popularActions: [
      { slug: 'slack_send_message', name: 'Post Message', description: 'Send a message to a channel' },
      { slug: 'slack_send_dm', name: 'Send Direct Message', description: 'Send a DM to a colleague' }
    ]
  },
  {
    slug: 'github',
    name: 'GitHub',
    icon: 'i-logos-github-icon',
    description: 'Create issues, review pull requests, create comments, and watch repository events.',
    category: 'developer',
    popularActions: [
      { slug: 'github_create_issue', name: 'Create Issue', description: 'File a new issue on a repo' },
      { slug: 'github_create_comment', name: 'Add Issue Comment', description: 'Comment on an issue or PR' }
    ]
  },
  {
    slug: 'notion',
    name: 'Notion',
    icon: 'i-logos-notion-icon',
    description: 'Create database entries, update wiki documentation, and sync onboarding cards.',
    category: 'productivity',
    popularActions: [
      { slug: 'notion_create_page', name: 'Create Page', description: 'Create a new Notion doc/page' },
      { slug: 'notion_update_database', name: 'Update Database', description: 'Add row to Notion database' }
    ]
  },
  {
    slug: 'linear',
    name: 'Linear',
    icon: 'i-logos-linear-icon',
    description: 'Create tracking tickets, manage cycles, and update issue progress.',
    category: 'project_management',
    popularActions: [
      { slug: 'linear_create_issue', name: 'Create Issue', description: 'File engineering ticket' },
      { slug: 'linear_update_issue', name: 'Update Issue', description: 'Change status or priority' }
    ]
  },
  {
    slug: 'discord',
    name: 'Discord',
    icon: 'i-logos-discord-icon',
    description: 'Broadcast community messages, send embed alerts, and manage server announcements.',
    category: 'communication',
    popularActions: [
      { slug: 'discord_send_message', name: 'Send Message', description: 'Post alert to Discord channel' }
    ]
  }
]
`;

let clientCode = fs.readFileSync('server/services/composio/client.ts', 'utf8');
if (!clientCode.includes('POPULAR_COMPOSIO_TOOLKITS')) {
  clientCode += '\n' + toolkitsList;
  fs.writeFileSync('server/services/composio/client.ts', clientCode);
  console.log('Appended POPULAR_COMPOSIO_TOOLKITS to client.ts');
}
