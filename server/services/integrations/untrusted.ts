/**
 * Wraps data from earlier workflow steps or outside callers so a model can tell it from instructions.
 * `<`, `>` and `&` are written as escapes, so a value can never contain the closing tag and step out of the block.
 */
export function untrustedBlock(data: unknown, maxChars = 6000): string {
  const json = (JSON.stringify(data ?? null) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .slice(0, maxChars)
  return `<untrusted_workflow_data>\n${json}\n</untrusted_workflow_data>`
}
