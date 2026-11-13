/**
 * Some models (GPT OSS on Groq, for one) write their own source markers into the answer, like 【2†L12-L15】,
 * pointing at lines in their private search results. They mean nothing to a reader, so they are taken out.
 * The source links stay on the search trace row.
 */
export function withoutSourceMarks(text: string): string {
  return text
    .replace(/[ \t]*【[^】\n]{1,80}】/g, '')
    .replace(/[ \t]+$/gm, '')
}
