/**
 * What OpenLobs can actually do with each app, in plain language. Everything here is something the
 * agent does through the user's own connected account (in chat, or as a step in a workflow).
 * Workflows start manually or from a webhook today, so nothing below promises scheduled or
 * "when a new email arrives" triggers.
 */
export interface Ability { icon: string, title: string, detail: string }
export interface WorkflowIdea { title: string, detail: string, prompt: string }
export interface Showcase {
  tagline: string
  overview: string
  abilities: Ability[]
  prompts: string[]
  ideas: WorkflowIdea[]
}

const read = (title: string, detail: string): Ability => ({ icon: 'i-lucide-search', title, detail })
const write = (title: string, detail: string): Ability => ({ icon: 'i-lucide-pen-line', title, detail })
const send = (title: string, detail: string): Ability => ({ icon: 'i-lucide-send', title, detail })
const organize = (title: string, detail: string): Ability => ({ icon: 'i-lucide-folder-tree', title, detail })
const analyze = (title: string, detail: string): Ability => ({ icon: 'i-lucide-chart-no-axes-combined', title, detail })
const track = (title: string, detail: string): Ability => ({ icon: 'i-lucide-list-checks', title, detail })

export const SHOWCASE: Record<string, Showcase> = {
  gmail: {
    tagline: 'Triage your inbox, draft replies, and send mail on your behalf.',
    overview: 'OpenLobs reads and searches your mail, understands what each message needs, and writes the reply for you to review. It can also send mail directly when you ask.',
    abilities: [
      read('Search and read mail', 'Find messages by sender, topic or date and pull out what matters.'),
      write('Draft replies', 'Write a reply in your tone and leave it as a draft for you to check.'),
      send('Send emails', 'Send a message to anyone, with the details you give or the ones it found.'),
      organize('Triage and summarise', 'Sort what needs a reply from what can wait, with a short summary of each thread.')
    ],
    prompts: [
      'Summarise my unread emails from today and tell me which ones need a reply.',
      'Find the latest email from a client asking for a proposal and draft a response.',
      'Search my inbox for invoices from last month and list the amounts.'
    ],
    ideas: [
      { title: 'Client inquiry to proposal', detail: 'Read a new inquiry, draft a proposal, and save it to Drive for review.', prompt: 'Create a workflow that reads a client inquiry from Gmail, drafts a proposal, and saves it to Google Drive, with an approval step before anything is sent.' },
      { title: 'Daily inbox digest', detail: 'Summarise the inbox and post the highlights to Slack.', prompt: 'Create a workflow that summarises my unread Gmail and posts the key items to Slack.' }
    ]
  },
  google_drive: {
    tagline: 'Find, organise and create files without leaving the chat.',
    overview: 'OpenLobs searches your Drive, creates folders, and saves the documents it writes, so finished work lands where your team already looks.',
    abilities: [
      read('Search files', 'Locate documents, sheets and decks by name or content.'),
      organize('Create folders', 'Set up a tidy folder for each client or project.'),
      write('Save what it writes', 'Store proposals, reports and summaries straight into Drive.'),
      send('Share documents', 'Hand a file to the right people once it is ready.')
    ],
    prompts: [
      'Find the most recent proposal in my Drive and summarise what it commits us to.',
      'Create a folder for a new client called Acme and list what is already in my Drive about them.',
      'Look for any files I changed this week and give me a short list.'
    ],
    ideas: [
      { title: 'New client workspace', detail: 'Create a client folder and drop the kickoff documents into it.', prompt: 'Create a workflow that creates a Google Drive folder for a new client and saves a kickoff summary into it.' },
      { title: 'Weekly report to Drive', detail: 'Compile a weekly report and file it automatically.', prompt: 'Create a workflow that writes a weekly status report and saves it to a Google Drive folder.' }
    ]
  },
  google_calendar: {
    tagline: 'Check availability and schedule meetings in one step.',
    overview: 'OpenLobs looks at your calendar, finds open time, and creates the event with invitees, so scheduling stops being back and forth.',
    abilities: [
      read('See what is coming up', 'List today\'s or this week\'s events and what they involve.'),
      analyze('Find free time', 'Spot slots that work for you before suggesting them.'),
      write('Schedule meetings', 'Create events with the right title, time and guests.'),
      send('Send invites', 'Invite attendees as part of creating the event.')
    ],
    prompts: [
      'What does my calendar look like tomorrow, and where are my free two-hour blocks?',
      'Schedule a 30 minute kickoff call with the client next Tuesday afternoon.',
      'List my meetings this week that have no description.'
    ],
    ideas: [
      { title: 'Book a kickoff call', detail: 'Find a free slot and send the invite after the contract is signed.', prompt: 'Create a workflow that finds a free slot in my Google Calendar and books a kickoff call, asking for my approval first.' },
      { title: 'Morning agenda', detail: 'Send yourself today\'s schedule each time you run it.', prompt: 'Create a workflow that reads today\'s Google Calendar events and posts an agenda to Slack.' }
    ]
  },
  google_docs: {
    tagline: 'Turn ideas into finished documents.',
    overview: 'OpenLobs writes proposals, briefs and summaries and creates them as real Google Docs you can edit and share.',
    abilities: [
      write('Create documents', 'Start a new, styled doc from a prompt or from earlier steps in a workflow.'),
      write('Add to existing docs', 'Append notes, sections or summaries to a doc you already have.'),
      read('Read and summarise', 'Pull out the key points of a long document.'),
      organize('Standard formats', 'Produce proposals, requirements docs and executive summaries in a consistent shape.')
    ],
    prompts: [
      'Write a one page proposal for a website redesign and create it as a Google Doc.',
      'Summarise my latest requirements document in five bullet points.',
      'Add a "Next steps" section to the project brief.'
    ],
    ideas: [
      { title: 'Proposal generator', detail: 'Turn a client brief into a ready-to-review proposal doc.', prompt: 'Create a workflow that takes a client brief, writes a proposal, and creates it as a Google Doc.' },
      { title: 'Meeting notes to doc', detail: 'Turn raw notes into a clean summary document.', prompt: 'Create a workflow that turns meeting notes into a structured Google Doc with action items.' }
    ]
  },
  google_sheets: {
    tagline: 'Read, update and build spreadsheets from plain language.',
    overview: 'OpenLobs reads ranges, appends rows and creates sheets, so your tracker updates itself while you work.',
    abilities: [
      read('Read data', 'Fetch rows and ranges and answer questions about them.'),
      write('Append and update rows', 'Log new records or fix existing cells.'),
      write('Create spreadsheets', 'Set up a new sheet with the columns you need.'),
      analyze('Summarise numbers', 'Total, compare and explain what the data says.')
    ],
    prompts: [
      'Read my sales sheet and tell me which month was strongest.',
      'Add a row to my client tracker for Acme with today\'s date and status "Onboarding".',
      'Create a new spreadsheet for tracking project expenses.'
    ],
    ideas: [
      { title: 'Log every inquiry', detail: 'Add each client inquiry as a new row in a tracking sheet.', prompt: 'Create a workflow that records a client inquiry as a new row in a Google Sheet.' },
      { title: 'Weekly numbers summary', detail: 'Read a sheet and send the headline numbers to Slack.', prompt: 'Create a workflow that reads a Google Sheet and posts a summary of the key numbers to Slack.' }
    ]
  },
  google_tasks: {
    tagline: 'Capture and track to-dos from anything you discuss.',
    overview: 'OpenLobs turns action items into tasks, ticks off finished ones and lists what is still open.',
    abilities: [
      write('Create tasks', 'Add a to-do with the details you mention.'),
      track('Complete tasks', 'Mark items done as you finish them.'),
      read('List what is open', 'See everything still waiting for you.'),
      organize('From notes to tasks', 'Convert meeting notes into a task list in one go.')
    ],
    prompts: [
      'Add a task to send the invoice to Acme by Friday.',
      'What tasks do I still have open?',
      'Turn these meeting notes into tasks.'
    ],
    ideas: [
      { title: 'Action items from meetings', detail: 'Extract action items from notes and create a task for each.', prompt: 'Create a workflow that extracts action items from meeting notes and creates a Google Task for each.' },
      { title: 'Follow-up reminders', detail: 'Create follow-up tasks after sending a proposal.', prompt: 'Create a workflow that creates a follow-up task after a proposal is sent.' }
    ]
  },
  slack: {
    tagline: 'Keep your team in the loop and act from the conversation.',
    overview: 'OpenLobs posts updates, creates channels for new work, and reads recent conversation so summaries and alerts reach people where they already talk.',
    abilities: [
      send('Post messages', 'Send updates or alerts to any channel you have access to.'),
      organize('Create channels', 'Spin up a dedicated channel for a client or project.'),
      read('Catch up on a channel', 'Summarise what you missed in a busy channel.'),
      write('React and acknowledge', 'Confirm that something was processed.')
    ],
    prompts: [
      'Summarise what happened in #general today.',
      'Create a channel called #acme-onboarding and post a welcome message.',
      'Post a short status update to #team about this week\'s progress.'
    ],
    ideas: [
      { title: 'Onboarding announcement', detail: 'Create a client channel and notify the team when a deal closes.', prompt: 'Create a workflow that creates a Slack channel for a new client and notifies the team.' },
      { title: 'Daily digest to Slack', detail: 'Send a morning summary to your team channel.', prompt: 'Create a workflow that posts a daily summary to a Slack channel.' }
    ]
  },
  discord: {
    tagline: 'Announce, notify and manage your community server.',
    overview: 'OpenLobs sends announcements and messages to your Discord channels and can set up new channels as your community grows.',
    abilities: [
      send('Post announcements', 'Send messages and updates to a channel.'),
      organize('Create channels', 'Add channels for new projects or members.'),
      read('Check recent activity', 'Catch up on what has been discussed.'),
      write('Draft community updates', 'Write the post, then publish it when you say so.')
    ],
    prompts: [
      'Post a release announcement to the #updates channel.',
      'Create a new channel for our beta testers.',
      'Summarise the latest messages in #support.'
    ],
    ideas: [
      { title: 'Release announcements', detail: 'Write and post an update to Discord each time you ship.', prompt: 'Create a workflow that writes a release announcement and posts it to a Discord channel.' },
      { title: 'New member welcome', detail: 'Greet people and point them to the right channels.', prompt: 'Create a workflow that posts a welcome message to a Discord channel.' }
    ]
  },
  notion: {
    tagline: 'Keep pages, notes and databases up to date.',
    overview: 'OpenLobs creates pages, adds entries to your databases and finds what you wrote, so notes become structured knowledge.',
    abilities: [
      write('Create pages', 'Start a page for meeting notes, specs or research.'),
      write('Add to databases', 'Log records into a Notion database.'),
      read('Search your workspace', 'Find the page or entry you need.'),
      organize('Structure notes', 'Turn messy input into clean headings and lists.')
    ],
    prompts: [
      'Create a Notion page for today\'s meeting with the agenda and action items.',
      'Find my notes about the pricing decision.',
      'Add this idea to my product backlog database.'
    ],
    ideas: [
      { title: 'Meeting notes archive', detail: 'File each meeting summary as a Notion page.', prompt: 'Create a workflow that turns meeting notes into a structured Notion page.' },
      { title: 'Research capture', detail: 'Research a topic and save the findings to Notion.', prompt: 'Create a workflow that researches a topic on the web and saves the summary to Notion.' }
    ]
  },
  linear: {
    tagline: 'File and triage issues without opening the board.',
    overview: 'OpenLobs creates well written issues from a sentence, reads your backlog and helps you decide what to pick up next.',
    abilities: [
      write('File issues', 'Turn a description or bug report into a clear issue.'),
      read('Review your backlog', 'List what is open, urgent or unassigned.'),
      track('Update status', 'Move work along as things happen.'),
      analyze('Triage', 'Group requests and suggest priorities.')
    ],
    prompts: [
      'Create a bug issue: users cannot reset their password on mobile.',
      'List the open issues assigned to me, highest priority first.',
      'Which issues have been open longest without an update?'
    ],
    ideas: [
      { title: 'Bug report to issue', detail: 'Turn reports from email or Slack into Linear issues.', prompt: 'Create a workflow that turns a bug report into a Linear issue and notifies the team on Slack.' },
      { title: 'Weekly backlog review', detail: 'Summarise what is stuck and what shipped.', prompt: 'Create a workflow that summarises my open Linear issues and posts the summary to Slack.' }
    ]
  },
  jira: {
    tagline: 'Create tickets and keep sprints moving.',
    overview: 'OpenLobs writes tickets, reads sprint boards and updates workflows, so project tracking takes less of your day.',
    abilities: [
      write('Create tickets', 'Open stories, bugs and tasks with the right details.'),
      read('Read the board', 'See what is in the sprint and who owns it.'),
      track('Update progress', 'Transition tickets as work completes.'),
      analyze('Summarise a sprint', 'Explain what is done, blocked and at risk.')
    ],
    prompts: [
      'Create a Jira task to update the onboarding documentation.',
      'What is blocked in the current sprint?',
      'Summarise the tickets I closed this week.'
    ],
    ideas: [
      { title: 'Requests into tickets', detail: 'Convert incoming requests into Jira tickets automatically.', prompt: 'Create a workflow that turns a request into a Jira ticket and posts the link to Slack.' },
      { title: 'Sprint report', detail: 'Generate a clean end-of-sprint summary.', prompt: 'Create a workflow that summarises my Jira sprint and saves the report to Google Docs.' }
    ]
  },
  github: {
    tagline: 'Work with repositories, issues and pull requests in plain language.',
    overview: 'OpenLobs reads your repos, opens issues, and summarises pull requests, so staying on top of code activity is a conversation.',
    abilities: [
      read('Browse repositories', 'Look through repos, issues and pull requests.'),
      write('Open issues', 'File a clear issue from a short description.'),
      analyze('Summarise pull requests', 'Explain what changed and what to review.'),
      track('Follow activity', 'See what is new across your projects.')
    ],
    prompts: [
      'Summarise the open pull requests in my main repository.',
      'Create an issue titled "Add dark mode" with a short description.',
      'What changed in the repo this week?'
    ],
    ideas: [
      { title: 'Release notes', detail: 'Draft release notes from recent merged work.', prompt: 'Create a workflow that reads recent GitHub pull requests and drafts release notes.' },
      { title: 'Issue triage digest', detail: 'Summarise new issues and post them to Slack.', prompt: 'Create a workflow that summarises new GitHub issues and posts them to Slack.' }
    ]
  },
  gitlab: {
    tagline: 'Keep merge requests and pipelines under control.',
    overview: 'OpenLobs reads projects, files issues and keeps you informed about merge requests and pipelines.',
    abilities: [
      read('Read projects', 'Browse issues and merge requests.'),
      write('File issues', 'Open an issue from a description.'),
      analyze('Review summaries', 'Explain what a merge request changes.'),
      track('Watch pipelines', 'Check on builds and what failed.')
    ],
    prompts: [
      'List the open merge requests that need my review.',
      'Create an issue for the failing deployment job.',
      'Summarise the latest pipeline failures.'
    ],
    ideas: [
      { title: 'Review reminders', detail: 'Collect merge requests that are waiting and nudge the team.', prompt: 'Create a workflow that lists open GitLab merge requests and posts a reminder to Slack.' },
      { title: 'Failure report', detail: 'Summarise failed pipelines in a short report.', prompt: 'Create a workflow that summarises failed GitLab pipelines.' }
    ]
  },
  trello: {
    tagline: 'Add cards and move work across your boards.',
    overview: 'OpenLobs creates cards, fills in checklists and updates status, keeping boards current as you work.',
    abilities: [
      write('Add cards', 'Capture a task as a card on the right list.'),
      track('Move work along', 'Update where a card sits as it progresses.'),
      read('Review a board', 'See what is in each list.'),
      organize('Checklists', 'Break a card into steps.')
    ],
    prompts: [
      'Add a card "Send invoice to Acme" to my To Do list.',
      'What is in my In Progress list?',
      'Create a checklist for onboarding a new client.'
    ],
    ideas: [
      { title: 'Requests to cards', detail: 'Turn incoming requests into Trello cards.', prompt: 'Create a workflow that turns a request into a Trello card.' },
      { title: 'Board summary', detail: 'Post a weekly snapshot of the board to Slack.', prompt: 'Create a workflow that summarises my Trello board and posts it to Slack.' }
    ]
  },
  asana: {
    tagline: 'Assign work and keep milestones on track.',
    overview: 'OpenLobs creates tasks, sets owners and dates, and reports what is due, so projects stay organised.',
    abilities: [
      write('Create and assign tasks', 'Add tasks with owner and due date.'),
      track('Update milestones', 'Keep project progress current.'),
      read('See what is due', 'List overdue or upcoming work.'),
      analyze('Project summaries', 'Explain where a project stands.')
    ],
    prompts: [
      'List everything in Asana that is overdue, grouped by owner.',
      'Create a task for the design review due next Friday.',
      'Summarise the status of the website project.'
    ],
    ideas: [
      { title: 'Action items to tasks', detail: 'Turn meeting action items into Asana tasks.', prompt: 'Create a workflow that turns meeting action items into Asana tasks.' },
      { title: 'Overdue digest', detail: 'Send a weekly list of overdue work.', prompt: 'Create a workflow that lists overdue Asana tasks and posts them to Slack.' }
    ]
  },
  clickup: {
    tagline: 'Sync tasks, docs and time estimates.',
    overview: 'OpenLobs creates tasks, reads your workspace and keeps fields up to date across ClickUp.',
    abilities: [
      write('Create tasks', 'Add tasks with fields and estimates.'),
      read('Search the workspace', 'Find tasks and docs quickly.'),
      track('Update status', 'Keep work moving.'),
      analyze('Summaries', 'Report on a list or space.')
    ],
    prompts: [
      'Create a ClickUp task to prepare the quarterly report.',
      'Show me the tasks due this week.',
      'Summarise progress on the launch project.'
    ],
    ideas: [
      { title: 'Intake to tasks', detail: 'Turn new requests into ClickUp tasks.', prompt: 'Create a workflow that turns a request into a ClickUp task.' },
      { title: 'Weekly progress', detail: 'Summarise the week and share it.', prompt: 'Create a workflow that summarises ClickUp progress and posts it to Slack.' }
    ]
  },
  hubspot: {
    tagline: 'Keep your CRM current and follow up on time.',
    overview: 'OpenLobs reads contacts and deals, logs activity and drafts follow-ups, so leads do not go cold.',
    abilities: [
      read('Look up contacts and deals', 'Find who someone is and where the deal stands.'),
      write('Log activity', 'Record notes and updates against a contact.'),
      analyze('Spot stalled deals', 'Highlight deals that have gone quiet.'),
      send('Draft follow-ups', 'Write the next message for each lead.')
    ],
    prompts: [
      'Which HubSpot deals have had no activity for two weeks?',
      'Summarise the newest contacts and what we know about them.',
      'Log a note on Acme: they asked for a revised quote.'
    ],
    ideas: [
      { title: 'Lead follow-up', detail: 'Draft a follow-up for every stalled lead.', prompt: 'Create a workflow that finds stalled HubSpot deals and drafts follow-up emails in Gmail.' },
      { title: 'Deal summary to Slack', detail: 'Share pipeline highlights with the team.', prompt: 'Create a workflow that summarises my HubSpot pipeline and posts it to Slack.' }
    ]
  },
  salesforce: {
    tagline: 'Work with accounts, leads and opportunities.',
    overview: 'OpenLobs reads and updates Salesforce records and summarises accounts so you walk into calls prepared.',
    abilities: [
      read('Find records', 'Look up accounts, leads and opportunities.'),
      write('Update records', 'Add notes or change fields.'),
      analyze('Account briefings', 'Summarise an account before a call.'),
      track('Pipeline checks', 'See what is moving and what is not.')
    ],
    prompts: [
      'Give me a briefing on the Acme account before my call.',
      'List the opportunities closing this month.',
      'Add a note to the Globex lead about today\'s conversation.'
    ],
    ideas: [
      { title: 'Pre-call brief', detail: 'Prepare a one page briefing for each meeting.', prompt: 'Create a workflow that prepares a briefing from Salesforce for an upcoming client call and saves it to Google Docs.' },
      { title: 'Pipeline update', detail: 'Share pipeline status with the team.', prompt: 'Create a workflow that summarises Salesforce opportunities and posts to Slack.' }
    ]
  },
  airtable: {
    tagline: 'Query and update your bases in plain language.',
    overview: 'OpenLobs reads your tables, creates records and keeps related data in sync.',
    abilities: [
      read('Query tables', 'Ask questions about the records in a base.'),
      write('Create records', 'Add rows with the fields you give.'),
      track('Update records', 'Change status or details on existing rows.'),
      analyze('Summaries', 'Count, group and explain what is in a table.')
    ],
    prompts: [
      'Show me the records in my Projects table that are still open.',
      'Add a new record for Acme with status "Lead".',
      'How many records were added this month?'
    ],
    ideas: [
      { title: 'Log submissions', detail: 'Store incoming requests as Airtable records.', prompt: 'Create a workflow that stores an incoming request as a record in Airtable.' },
      { title: 'Table digest', detail: 'Summarise a table and share the highlights.', prompt: 'Create a workflow that summarises an Airtable table and posts it to Slack.' }
    ]
  },
  microsoft_teams: {
    tagline: 'Send alerts and updates where your team works.',
    overview: 'OpenLobs posts to Teams channels, messages colleagues and shares meeting updates.',
    abilities: [
      send('Post to channels', 'Send alerts and updates.'),
      send('Message people', 'Reach a colleague directly.'),
      read('Catch up', 'Summarise recent channel discussion.'),
      write('Announcements', 'Draft and publish team news.')
    ],
    prompts: [
      'Post a status update to the Project channel.',
      'Summarise the latest discussion in the General channel.',
      'Send a reminder about tomorrow\'s review to the team.'
    ],
    ideas: [
      { title: 'Status broadcast', detail: 'Share a daily or weekly status in Teams.', prompt: 'Create a workflow that writes a status update and posts it to Microsoft Teams.' },
      { title: 'Alert on completion', detail: 'Notify the team when a workflow finishes.', prompt: 'Create a workflow that notifies a Microsoft Teams channel when it completes.' }
    ]
  },
  outlook: {
    tagline: 'Handle work email and meetings in Outlook.',
    overview: 'OpenLobs reads and drafts email, and manages your Outlook calendar, so your workday needs fewer clicks.',
    abilities: [
      read('Search mail', 'Find messages and pull out what matters.'),
      write('Draft replies', 'Write responses for you to review.'),
      write('Schedule meetings', 'Create events and invite people.'),
      organize('Triage', 'Separate what needs action from the rest.')
    ],
    prompts: [
      'Summarise my unread Outlook mail and flag anything urgent.',
      'Draft a reply to the latest message from Acme.',
      'Find a free hour on Thursday and schedule a review.'
    ],
    ideas: [
      { title: 'Inbox digest', detail: 'Summarise email and share the highlights.', prompt: 'Create a workflow that summarises my Outlook inbox and posts the highlights to Teams.' },
      { title: 'Meeting scheduling', detail: 'Find a time and send the invite.', prompt: 'Create a workflow that finds a free slot in Outlook and schedules a meeting, asking for my approval first.' }
    ]
  },
  one_drive: {
    tagline: 'Store and share files in your Microsoft cloud.',
    overview: 'OpenLobs uploads files, organises folders and creates share links.',
    abilities: [
      write('Upload files', 'Save what OpenLobs creates.'),
      organize('Manage folders', 'Keep work tidy.'),
      read('Find files', 'Search for documents.'),
      send('Share links', 'Generate a link to share.')
    ],
    prompts: [
      'Find the latest budget file in my OneDrive.',
      'Create a folder for the Acme project.',
      'Give me a share link for the proposal.'
    ],
    ideas: [
      { title: 'File the deliverable', detail: 'Save finished documents to a client folder.', prompt: 'Create a workflow that saves a generated document to a OneDrive folder.' },
      { title: 'Share on completion', detail: 'Create a share link and post it to Teams.', prompt: 'Create a workflow that creates a OneDrive share link and posts it to Microsoft Teams.' }
    ]
  },
  excel: {
    tagline: 'Read and update workbooks and models.',
    overview: 'OpenLobs reads workbook data, adds rows and helps you make sense of the numbers.',
    abilities: [
      read('Read workbooks', 'Fetch rows and ranges.'),
      write('Update rows', 'Add or change records.'),
      write('Create workbooks', 'Start a new spreadsheet.'),
      analyze('Explain the numbers', 'Summarise and compare.')
    ],
    prompts: [
      'Read my budget workbook and tell me where we are overspending.',
      'Add a new row to the expenses sheet.',
      'Create a workbook to track project hours.'
    ],
    ideas: [
      { title: 'Log into Excel', detail: 'Append each new record to a workbook.', prompt: 'Create a workflow that appends incoming records to an Excel workbook.' },
      { title: 'Numbers summary', detail: 'Summarise a workbook and share it.', prompt: 'Create a workflow that summarises an Excel workbook and posts it to Microsoft Teams.' }
    ]
  },
  word: {
    tagline: 'Draft proposals and formal documents.',
    overview: 'OpenLobs writes structured documents and creates them as Word files you can edit.',
    abilities: [
      write('Create documents', 'Produce proposals and requirements.'),
      read('Summarise', 'Pull out the key points.'),
      organize('Standard structure', 'Keep a consistent shape.'),
      write('Revise', 'Update sections as things change.')
    ],
    prompts: [
      'Write a project proposal and create it as a Word document.',
      'Summarise my latest requirements document.',
      'Add a risks section to the proposal.'
    ],
    ideas: [
      { title: 'Proposal to Word', detail: 'Turn a brief into a proposal document.', prompt: 'Create a workflow that writes a proposal from a brief and creates it as a Word document.' },
      { title: 'Document to team', detail: 'Draft a document and notify the team.', prompt: 'Create a workflow that drafts a Word document and notifies the team.' }
    ]
  },
  powerpoint: {
    tagline: 'Turn briefs into slide decks.',
    overview: 'OpenLobs drafts presentation content and creates decks, so you start from a good first version.',
    abilities: [
      write('Create decks', 'Build slides from an outline or brief.'),
      organize('Structure', 'Order the story clearly.'),
      read('Summarise decks', 'Pull out the key messages.'),
      write('Update slides', 'Add or revise content.')
    ],
    prompts: [
      'Create a five slide deck summarising our quarterly results.',
      'Summarise the main points of my last presentation.',
      'Add a roadmap slide.'
    ],
    ideas: [
      { title: 'Briefing deck', detail: 'Turn research into a short deck.', prompt: 'Create a workflow that researches a topic on the web and creates a short PowerPoint briefing.' },
      { title: 'Update deck', detail: 'Refresh a deck with new numbers.', prompt: 'Create a workflow that updates a PowerPoint deck with new figures.' }
    ]
  },
  powerbi: {
    tagline: 'Refresh data and keep reports current.',
    overview: 'OpenLobs triggers dataset refreshes and works with your reports and dashboards.',
    abilities: [
      track('Refresh datasets', 'Update data on demand.'),
      read('Look at reports', 'See what a dashboard shows.'),
      analyze('Explain the data', 'Describe what changed.'),
      organize('Manage dashboards', 'Keep reports organised.')
    ],
    prompts: [
      'Refresh the sales dataset.',
      'What does the revenue dashboard show this month?',
      'List the reports in my workspace.'
    ],
    ideas: [
      { title: 'Refresh and report', detail: 'Refresh the data, then share the summary.', prompt: 'Create a workflow that refreshes a Power BI dataset and posts a summary to Microsoft Teams.' },
      { title: 'Morning numbers', detail: 'Share the latest figures with the team.', prompt: 'Create a workflow that reads a Power BI report and posts the key numbers.' }
    ]
  },
  zendesk: {
    tagline: 'Create tickets and watch escalations.',
    overview: 'OpenLobs opens support tickets, adds internal notes and keeps an eye on what needs attention.',
    abilities: [
      write('Create tickets', 'Open a ticket from a message.'),
      write('Add internal notes', 'Record context for your team.'),
      read('Review the queue', 'See what is open and urgent.'),
      analyze('Spot escalations', 'Flag tickets that need attention.')
    ],
    prompts: [
      'List the urgent tickets still open.',
      'Create a ticket for the customer who reported a billing issue.',
      'Add an internal note to the latest ticket about today\'s call.'
    ],
    ideas: [
      { title: 'Email to ticket', detail: 'Turn support emails into Zendesk tickets.', prompt: 'Create a workflow that turns a support email into a Zendesk ticket.' },
      { title: 'Escalation alert', detail: 'Alert the team about urgent tickets.', prompt: 'Create a workflow that finds urgent Zendesk tickets and alerts Slack.' }
    ]
  },
  stripe: {
    tagline: 'Look up customers, payments and subscriptions.',
    overview: 'OpenLobs answers questions about your customers and revenue by reading your Stripe data.',
    abilities: [
      read('Find customers', 'Look up a customer and their history.'),
      read('Check payments', 'See charges and invoices.'),
      analyze('Summarise revenue', 'Explain what came in and what is due.'),
      track('Subscriptions', 'See who is subscribed and their status.')
    ],
    prompts: [
      'Which invoices are still unpaid?',
      'Summarise this month\'s payments.',
      'Look up the subscription status for Acme.'
    ],
    ideas: [
      { title: 'Payment summary', detail: 'Send a weekly revenue summary to Slack.', prompt: 'Create a workflow that summarises recent Stripe payments and posts it to Slack.' },
      { title: 'Unpaid invoice list', detail: 'Collect unpaid invoices for follow-up.', prompt: 'Create a workflow that lists unpaid Stripe invoices and drafts follow-up emails.' }
    ]
  }
}

/** What OpenLobs can do with any connected app, shown above the per-app details. */
export const PILLARS: Ability[] = [
  { icon: 'i-lucide-search', title: 'Read and search', detail: 'Ask questions about your mail, files, tickets and records, and get answers from the real thing.' },
  { icon: 'i-lucide-pen-line', title: 'Create and update', detail: 'Draft documents, file issues, add rows and send messages through the accounts you connect.' },
  { icon: 'i-lucide-workflow', title: 'Automate with workflows', detail: 'Chain apps together on a canvas, with an approval step before anything important happens.' }
]

export function showcaseFor(provider: string): Showcase | null {
  return SHOWCASE[provider] ?? null
}
