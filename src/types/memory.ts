export interface MemoryItem {
  id: string
  text: string
  source: 'user' | 'assistant'
  createdAt: string
}

export interface MemoryLimits { maxItems: number, maxChars: number }
