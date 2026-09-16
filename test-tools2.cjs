const { Composio } = require('@composio/core');
const { VercelProvider } = require('@composio/vercel');
const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, provider: new VercelProvider() });
async function run() {
  try {
    const session = await client.sessions.create({ entityId: 'hansonmens784@gmail.com', toolkits: ['github', 'slack', 'gmail', 'asana', 'notion', 'trello'] });
    const tools = await session.tools();
    console.log(Object.keys(tools).length, 'tools returned');
  } catch(e) { console.error(e) }
}
run();
