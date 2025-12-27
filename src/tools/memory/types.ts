export interface MemoryWriteInput {
  fileName: string
  content: string
}

export interface MemoryReadInput {
  fileName: string
}

export interface MemoryListInput {}

export interface MemoryEditInput {
  fileName: string
  needle: string
  replacement: string
  mode: "literal" | "regex"
}

export interface MemoryDeleteInput {
  fileName: string
}

export interface MemoryToolResult {
  success: boolean
  content?: string
  files?: string[]
  error?: string
}
