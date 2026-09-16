const { Composio } = require('@composio/core');
const { VercelProvider } = require('@composio/vercel');
const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, provider: new VercelProvider() });
async function run() {
  const tools = await client.tools.get('hansonmens784@gmail.com', { toolkits: ['slack'] });
  console.log(Object.keys(tools).length, 'tools for slack');
  console.log('First tool key:', Object.keys(tools)[0]);
}
run();
