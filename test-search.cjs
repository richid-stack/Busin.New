const { generateText } = require('ai');
const { createGoogleGenerativeAI, google: googleGlobal } = require('@ai-sdk/google');

async function main() {
  try {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: 'What is the current stock price of Google today?',
      tools: {
        web_search: googleGlobal.tools.googleSearch({})
      }
    });
    console.log("Steps:");
    console.log(JSON.stringify(result.steps, null, 2));
    console.log("Text:");
    console.log(result.text);
  } catch (err) {
    console.error(err);
  }
}
main();
