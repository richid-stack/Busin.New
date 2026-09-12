const { streamText, toUIMessageStream } = require('ai');
const { createGoogleGenerativeAI, google: googleGlobal } = require('@ai-sdk/google');

async function main() {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const result = streamText({
    model: google('gemini-2.5-flash'),
    prompt: 'Who won the last Super Bowl?',
    tools: {
      web_search: googleGlobal.tools.googleSearch({})
    }
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    sendSources: true
  });

  for await (const chunk of stream) {
    console.log(chunk);
  }
}
main();
