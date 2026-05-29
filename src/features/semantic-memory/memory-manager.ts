import { runSg } from "@oh-my-opencode/ast-grep-mcp"
import { storeMemory, getRecentMemories } from "./memory"
import { getMemoryDb } from "./storage"
import type { MemoryEntry } from "./types"
import { getGlobalActivityBus } from "../activity-bus"
import { join } from "path"
import { existsSync, readFileSync } from "fs"

export function getLanguageFromFilePath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "ts":
    case "mts":
    case "cts":
      return "typescript"
    case "jsx":
      return "javascript"
    case "tsx":
      return "tsx"
    case "py":
      return "python"
    case "go":
      return "go"
    case "rs":
      return "rust"
    case "java":
      return "java"
    case "cpp":
    case "cc":
    case "h":
    case "hpp":
      return "cpp"
    case "c":
      return "c"
    case "cs":
      return "csharp"
    default:
      return null
  }
}

export const DECLARATION_PATTERNS: Record<string, string[]> = {
  typescript: [
    "class $NAME { $$$ }",
    "function $NAME($$$) { $$$ }",
    "const $NAME = ($$$) => { $$$ }",
    "interface $NAME { $$$ }",
    "type $NAME = $$$",
  ],
  tsx: [
    "class $NAME { $$$ }",
    "function $NAME($$$) { $$$ }",
    "const $NAME = ($$$) => { $$$ }",
    "interface $NAME { $$$ }",
    "type $NAME = $$$",
  ],
  javascript: [
    "class $NAME { $$$ }",
    "function $NAME($$$) { $$$ }",
    "const $NAME = ($$$) => { $$$ }",
  ],
  python: [
    "class $NAME: $$$",
    "def $NAME($$$): $$$",
  ],
  go: [
    "func $NAME($$$) { $$$ }",
    "type $NAME struct { $$$ }",
    "type $NAME interface { $$$ }",
  ],
  rust: [
    "fn $NAME($$$) { $$$ }",
    "struct $NAME { $$$ }",
    "impl $$$ $NAME { $$$ }",
  ],
}

export function extractSymbolName(text: string, lang: string): string | undefined {
  const cleanText = text.trim()
  let match: RegExpMatchArray | null = null

  if (["typescript", "tsx", "javascript"].includes(lang)) {
    match = cleanText.match(/class\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/function\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/)
    if (match) return match[1]
    match = cleanText.match(/interface\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/type\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
  } else if (lang === "python") {
    match = cleanText.match(/class\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/def\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
  } else if (lang === "go") {
    match = cleanText.match(/func\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/type\s+([a-zA-Z0-9_$]+)\s+(?:struct|interface)/)
    if (match) return match[1]
  } else if (lang === "rust") {
    match = cleanText.match(/fn\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/struct\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
    match = cleanText.match(/impl(?:\s+.*)?\s+([a-zA-Z0-9_$]+)/)
    if (match) return match[1]
  }

  return undefined
}

export function getChangedLineNumbers(before: string, after: string): number[] {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const changedLines: number[] = []

  const maxLen = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < maxLen; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      changedLines.push(i + 1)
    }
  }
  return changedLines
}

export async function recordCodeMemory(
  filePath: string,
  beforeContent: string,
  afterContent: string,
  options: {
    agentName?: string
    sessionId?: string
    explanation: string
    importance?: number
  }
): Promise<MemoryEntry[]> {
  const lang = getLanguageFromFilePath(filePath)
  const changedLines = getChangedLineNumbers(beforeContent, afterContent)

  if (!lang || changedLines.length === 0 || !DECLARATION_PATTERNS[lang]) {
    // Graceful fallback to document/file-level memory if language not supported or no lines changed
    const now = Date.now()
    const memory = storeMemory(options.explanation, {
      agentName: options.agentName,
      sessionId: options.sessionId,
      memoryType: "insight",
      importance: options.importance ?? 1.2,
      filePath,
      beforeContent,
      afterContent,
    })

    const bus = getGlobalActivityBus()
    await bus.emit({
      kind: "memory:stored",
      data: {
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        filePath: memory.filePath,
      },
    })

    return [memory]
  }

  const patterns = DECLARATION_PATTERNS[lang]
  const entries: MemoryEntry[] = []

  try {
    const results = await Promise.all(
      patterns.map(async (pattern) => {
        try {
          const res = await runSg({
            pattern,
            lang: lang as any,
            paths: [filePath],
            cwd: process.cwd(),
          })
          return { pattern, res }
        } catch {
          return { pattern, res: { matches: [], totalMatches: 0, truncated: false } }
        }
      })
    )

    // For each pattern query result, find matches overlapping with changed lines
    for (const { pattern, res } of results) {
      if (res.error || !res.matches) continue

      for (const match of res.matches) {
        const startLine = match.range.start.line // 0-indexed
        const endLine = match.range.end.line // 0-indexed

        const isOverlapping = changedLines.some(
          (line) => line - 1 >= startLine && line - 1 <= endLine
        )

        if (isOverlapping) {
          const symbolName = extractSymbolName(match.text, lang)
          
          // Generate precise AST pattern based on the match
          let astPattern = pattern
          if (symbolName) {
            astPattern = pattern.replace("$NAME", symbolName)
          }

          // Build snippet of code before/after if possible
          // Find symbol in beforeContent to extract beforeContent representation
          // (This is best effort; we can fallback to storing the match text as afterContent)
          const memory = storeMemory(options.explanation, {
            agentName: options.agentName,
            sessionId: options.sessionId,
            memoryType: "pattern",
            importance: options.importance ?? 1.8,
            filePath,
            symbolName,
            astPattern,
            beforeContent,
            afterContent,
          })

          entries.push(memory)

          const bus = getGlobalActivityBus()
          await bus.emit({
            kind: "memory:stored",
            data: {
              id: memory.id,
              content: memory.content,
              memoryType: memory.memoryType,
              filePath: memory.filePath,
              symbolName: memory.symbolName,
              astPattern: memory.astPattern,
            },
          })
        }
      }
    }
  } catch (err) {
    console.error("[MemoryManager] AFT extraction failed, falling back", err)
  }

  // If no specific declarations matched but changes exist, store general file memory
  if (entries.length === 0) {
    const memory = storeMemory(options.explanation, {
      agentName: options.agentName,
      sessionId: options.sessionId,
      memoryType: "insight",
      importance: options.importance ?? 1.2,
      filePath,
      beforeContent,
      afterContent,
    })
    entries.push(memory)

    const bus = getGlobalActivityBus()
    await bus.emit({
      kind: "memory:stored",
      data: {
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        filePath: memory.filePath,
      },
    })
  }

  return entries
}

export async function retrieveCodeMemories(
  workspaceFiles: string[],
  options: {
    agentName?: string
    sessionId?: string
  } = {}
): Promise<{ entry: MemoryEntry; matchFile: string; similarity: number }[]> {
  // Retrieve recent pattern memories with AST patterns
  const db = getMemoryDb()
  const rows = db.query(
    `SELECT * FROM memories WHERE ast_pattern IS NOT NULL AND ast_pattern != ''`
  ).all() as Array<{
    id: string
    content: string
    embedding: string
    agent_name: string | null
    session_id: string | null
    memory_type: string
    importance: number
    created_at: number
    accessed_at: number | null
    access_count: number
    file_path: string | null
    symbol_name: string | null
    ast_pattern: string | null
    before_content: string | null
    after_content: string | null
  }>

  const memories = rows.map((row) => ({
    id: row.id,
    content: row.content,
    embedding: JSON.parse(row.embedding) as number[],
    agentName: row.agent_name ?? undefined,
    sessionId: row.session_id ?? undefined,
    memoryType: row.memory_type as MemoryEntry["memoryType"],
    importance: row.importance,
    createdAt: new Date(row.created_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    accessCount: row.access_count,
    filePath: row.file_path ?? undefined,
    symbolName: row.symbol_name ?? undefined,
    astPattern: row.ast_pattern ?? undefined,
    beforeContent: row.before_content ?? undefined,
    afterContent: row.after_content ?? undefined,
  }))

  const matches: { entry: MemoryEntry; matchFile: string; similarity: number }[] = []

  // Check each file against the stored patterns using ast-grep
  for (const file of workspaceFiles) {
    if (!existsSync(file)) continue
    const lang = getLanguageFromFilePath(file)
    if (!lang) continue

    for (const entry of memories) {
      if (!entry.astPattern) continue

      try {
        const res = await runSg({
          pattern: entry.astPattern,
          lang: lang as any,
          paths: [file],
          cwd: process.cwd(),
        })

        if (res.matches && res.matches.length > 0) {
          matches.push({
            entry,
            matchFile: file,
            similarity: 1.0, // AST exact match has absolute structural relevance
          })

          // Update access count and accessed_at
          db.run(
            `UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?`,
            [Date.now(), entry.id]
          )

          const bus = getGlobalActivityBus()
          await bus.emit({
            kind: "memory:retrieved",
            data: {
              id: entry.id,
              content: entry.content,
              similarity: 1.0,
              filePath: file,
              symbolName: entry.symbolName,
              astPattern: entry.astPattern,
            },
          })
        }
      } catch {
        // Skip failed pattern queries gracefully
      }
    }
  }

  return matches
}
