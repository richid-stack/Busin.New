const { Composio } = require('@composio/core');
const { VercelProvider } = require('@composio/vercel');
const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, provider: new VercelProvider() });
async function run() {
  try {
    const session = await client.sessions.create('hansonmens784@gmail.com');
    const tools = await session.tools();
    console.log(Object.keys(tools).length, 'tools returned');
  } catch(e) { console.error(e) }
}
run();
