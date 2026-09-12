const fs = require('fs');
let code = fs.readFileSync('server/services/integrations/registry.ts', 'utf8');

const additionalGoogleIntegrations = `
  {
    provider: 'google_sheets',
    name: 'Google Sheets',
    type: 'native',
    icon: 'i-logos-google-sheets',
    category: 'google',
    description: 'Read rows, append data, and manage spreadsheets automatically.',
    capabilities: ['read_sheet', 'append_row', 'update_cell', 'create_sheet'],
    supportedEvents: ['Row Added', 'Cell Updated'],
    supportedActions: [
      { id: 'sheets_append_row', name: 'Append Row', description: 'Add a new row of data' },
      { id: 'sheets_read_range', name: 'Read Range', description: 'Read data from a specific range' }
    ]
  },
  {
    provider: 'google_docs',
    name: 'Google Docs',
    type: 'native',
    icon: 'i-logos-google-docs',
    category: 'google',
    description: 'Generate text documents, append content, and manage formatting.',
    capabilities: ['create_doc', 'append_text', 'replace_text', 'read_doc'],
    supportedEvents: ['Document Created'],
    supportedActions: [
      { id: 'docs_create', name: 'Create Document', description: 'Create a new Google Doc' },
      { id: 'docs_append', name: 'Append Text', description: 'Add text to end of document' }
    ]
  },
  {
    provider: 'google_tasks',
    name: 'Google Tasks',
    type: 'native',
    icon: 'i-logos-google-tasks',
    category: 'google',
    description: 'Manage your to-do lists, add tasks, and complete items.',
    capabilities: ['create_task', 'list_tasks', 'complete_task'],
    supportedEvents: ['Task Completed'],
    supportedActions: [
      { id: 'tasks_create', name: 'Create Task', description: 'Add a new task to your list' },
      { id: 'tasks_complete', name: 'Complete Task', description: 'Mark a task as done' }
    ]
  },
  {
    provider: 'google_calendar',
    name: 'Google Calendar',
    type: 'native',
    icon: 'i-logos-google-calendar',
    category: 'google',
    description: 'Schedule meetings, check availability, and manage calendar events.',
    capabilities: ['create_event', 'list_events', 'check_availability'],
    supportedEvents: ['Event Created', 'Event Starting'],
    supportedActions: [
      { id: 'calendar_create_event', name: 'Create Event', description: 'Schedule a new calendar event' },
      { id: 'calendar_list_events', name: 'List Events', description: 'Get upcoming events' }
    ]
  }
`;

code = code.replace(
  /export const NATIVE_GOOGLE_INTEGRATIONS: UnifiedIntegrationDefinition\[\] = \[([\s\S]*?)\]/g,
  `export const NATIVE_GOOGLE_INTEGRATIONS: UnifiedIntegrationDefinition[] = [$1, ${additionalGoogleIntegrations}]`
);

fs.writeFileSync('server/services/integrations/registry.ts', code);
console.log('Patched Google Integrations');
