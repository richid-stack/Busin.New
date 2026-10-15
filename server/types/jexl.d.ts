declare module 'jexl' {
  const jexl: {
    eval(expression: string, context?: Record<string, unknown>): Promise<unknown>
    evalSync(expression: string, context?: Record<string, unknown>): unknown
  }
  export default jexl
}
