const { convertToModelMessages } = require('ai');

async function run() {
  const messages = [
    {
      id: '123',
      role: 'user',
      content: 'hello',
      experimental_attachments: [
        {
          name: 'test.png',
          contentType: 'image/png',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        }
      ]
    }
  ];
  
  const res = await convertToModelMessages(messages);
  console.log(JSON.stringify(res, null, 2));
}
run();
