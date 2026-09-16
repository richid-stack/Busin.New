const fs = require('fs')

const file = 'server/services/composio/client.ts'
let content = fs.readFileSync(file, 'utf8')

// Microsoft Teams
content = content.replace(
  /{ slug: 'MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS', name: 'Get All Chats', description: 'Fetch team conversations and member activity' },/g,
  "{ slug: 'MICROSOFT_TEAMS_SEND_MESSAGE', name: 'Send Channel Alert', description: 'Send automated alerts and updates to team channels' },"
)
content = content.replace(
  /{ slug: 'MICROSOFT_TEAMS_CHATS_GET_ALL_MESSAGES', name: 'Get Chat Messages', description: 'Scan incoming and recent channel messages' },/g,
  "{ slug: 'MICROSOFT_TEAMS_SEND_ADAPTIVE_CARD', name: 'Post Adaptive Card', description: 'Post interactive adaptive cards to chats and channels' },"
)

// Outlook
content = content.replace(
  /{ slug: 'OUTLOOK_CREATE_MAIL_FOLDER', name: 'Create Mail Folder', description: 'Organize incoming emails into categorized folders' },/g,
  "{ slug: 'OUTLOOK_SEND_EMAIL', name: 'Send Enterprise Email', description: 'Draft and send enterprise emails to clients and team members' },"
)
content = content.replace(
  /{ slug: 'OUTLOOK_CREATE_CALENDAR', name: 'Create Calendar Event', description: 'Schedule meetings and send Outlook calendar invites' },/g,
  "{ slug: 'OUTLOOK_CREATE_EVENT', name: 'Schedule Calendar Invite', description: 'Schedule meetings and send Outlook calendar invites' },"
)

// OneDrive
content = content.replace(
  /{ slug: 'ONE_DRIVE_GET_DRIVE', name: 'Inspect Drive', description: 'Check accessible OneDrive drives and storage quotes' },/g,
  "{ slug: 'ONE_DRIVE_UPLOAD_FILE', name: 'Upload Document', description: 'Upload generated reports and documents to OneDrive' },"
)
content = content.replace(
  /{ slug: 'ONE_DRIVE_CREATE_LINK', name: 'Create Sharing Link', description: 'Generate view or edit links for uploaded files' },/g,
  "{ slug: 'ONE_DRIVE_CREATE_LINK', name: 'Generate Share Link', description: 'Generate view or edit links for uploaded files' },"
)
content = content.replace(
  /{ slug: 'ONE_DRIVE_DOWNLOAD_FILE', name: 'Download File', description: 'Fetch documents and files from cloud storage' }/g,
  "{ slug: 'ONE_DRIVE_DOWNLOAD_FILE', name: 'Fetch File', description: 'Fetch documents and files from enterprise cloud storage' }"
)

// Add Excel, Word, PowerPoint, Access, PowerBI to the array
const newTools = `
  {
    slug: 'excel',
    name: 'Microsoft Excel',
    icon: 'i-logos-microsoft-excel',
    description: 'Create spreadsheets, update workbook rows, and analyze financial models.',
    category: 'productivity',
    popularActions: [
      { slug: 'EXCEL_ADD_ROW', name: 'Append Row', description: 'Insert structured row into enterprise spreadsheet' },
      { slug: 'EXCEL_GET_WORKSHEET', name: 'Read Worksheet', description: 'Fetch records from specified range' },
      { slug: 'EXCEL_CREATE_WORKBOOK', name: 'Create Workbook', description: 'Create a new Excel workbook' }
    ]
  },
  {
    slug: 'word',
    name: 'Microsoft Word',
    icon: 'i-logos-microsoft-word',
    description: 'Generate enterprise proposals, technical requirements, and legal documents.',
    category: 'productivity',
    popularActions: [
      { slug: 'WORD_CREATE_DOCUMENT', name: 'Create Document', description: 'Create a new enterprise Word document' },
      { slug: 'WORD_APPEND_TEXT', name: 'Append Content', description: 'Insert text into a Word document' }
    ]
  },
  {
    slug: 'powerpoint',
    name: 'Microsoft PowerPoint',
    icon: 'i-logos-microsoft-powerpoint',
    description: 'Generate presentation slides, executive briefings, and deck templates.',
    category: 'productivity',
    popularActions: [
      { slug: 'POWERPOINT_CREATE_PRESENTATION', name: 'Create Presentation', description: 'Create a new presentation deck' },
      { slug: 'POWERPOINT_ADD_SLIDE', name: 'Add Slide', description: 'Append a slide to a presentation' }
    ]
  },
  {
    slug: 'powerbi',
    name: 'Microsoft PowerBI',
    icon: 'i-logos-microsoft-power-bi',
    description: 'Trigger dataset refreshes, export visual reports, and manage BI dashboards.',
    category: 'productivity',
    popularActions: [
      { slug: 'POWERBI_REFRESH_DATASET', name: 'Refresh Dataset', description: 'Trigger a data refresh on a PowerBI dataset' },
      { slug: 'POWERBI_EXPORT_REPORT', name: 'Export Report', description: 'Export a PowerBI report to PDF or Image' }
    ]
  },
`

content = content.replace(
  "  // --- Popular Productivity & Marketing Tools ---",
  newTools + "\n  // --- Popular Productivity & Marketing Tools ---"
)

fs.writeFileSync(file, content)
