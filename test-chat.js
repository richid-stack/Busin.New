const { convertToModelMessages } = require('ai');

const messages = [
  {
    id: "1",
    role: "user",
    content: "hello",
    parts: [
      { type: "text", text: "hello" },
      { type: "image", image: "data:image/png;base64,iVBORw..." }
    ]
  }
];

async function test() {
  const res = await convertToModelMessages(messages);
  console.log(JSON.stringify(res, null, 2));
}
test();
