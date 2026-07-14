import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import { createSearchEngine } from "../search/engine"
import type { MagicContextConfig } from "../../../config/schema/magic-context"

const DEFAULT_CHAR_BUDGET = 4000

export interface InjectContextOptions {
  messages: Array<{ role: string; content: string }>
  sessionId: string
  projectPath: string
}

export interface MagicContextInjector {
  injectContext(opts: InjectContextOptions): Promise<string[]>
}

export function createMagicContextInjector(
  config: MagicContextConfig,
  db: Database,
  embedder: Embedder,
): MagicContextInjector {
  const searchEngine = createSearchEngine(db, embedder)

  return { injectContext }

  async function injectContext(opts: InjectContextOptions): Promise<string[]> {
    if (!config.enabled) return []
    if (!config.memory.auto_search.enabled) return []

    const lastUserMessage = opts.messages.at(-1)
    if (!lastUserMessage || lastUserMessage.role !== "user") return []

    const text = lastUserMessage.content.trim()
    if (text.length < config.memory.auto_search.min_prompt_chars) return []

    const results = await searchEngine.search({
      text,
      sessionId: opts.sessionId,
      projectPath: opts.projectPath,
      limit: 5,
      threshold: config.memory.auto_search.score_threshold,
    })

    if (results.length === 0) return []

    const threshold = config.memory.auto_search.score_threshold
    const maxChars = threshold > 0.8
      ? DEFAULT_CHAR_BUDGET
      : Math.max(Math.floor(DEFAULT_CHAR_BUDGET * threshold), DEFAULT_CHAR_BUDGET / 4)

    const contextStrings: string[] = []
    let totalChars = 0

    for (const result of results) {
      const content = formatResult(result)
      if (totalChars + content.length > maxChars) break
      contextStrings.push(content)
      totalChars += content.length
    }

    return contextStrings
  }
}

function formatResult(result: { content: string; title: string; source: string; score: number }): string {
  return `[${result.source}] ${result.title}\n${result.content}`
}
