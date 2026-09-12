import type { UIToolInvocation } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

export type CalculatorUIToolInvocation = UIToolInvocation<typeof calculatorTool>

export const calculatorTool = tool({
  description: 'Evaluate mathematical expressions, statistical calculations, financial equations, or numerical comparisons with high precision.',
  inputSchema: z.object({
    expression: z.string().describe('The mathematical formula or expression to calculate (e.g., "(1500 * 1.05^5) - 1500")'),
    label: z.string().optional().describe('Short label or description of what is being computed')
  }),
  execute: async ({ expression, label }) => {
    try {
      // Clean and safely evaluate basic math expressions
      const sanitized = expression.replace(/[^0-9+\-*/().%^eE ]/g, '')
      const replaced = sanitized.replace(/\^/g, '**')
      // eslint-disable-next-line no-new-func
      const result = Function(`'use strict'; return (${replaced})`)()
      return {
        expression,
        label,
        result: typeof result === 'number' ? Number(result.toFixed(6)) : String(result),
        success: true
      }
    } catch {
      return {
        expression,
        label,
        result: 'Computation error',
        success: false
      }
    }
  }
})
