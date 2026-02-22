import type {
  ContextEntry,
  ContextPriority,
  ContextSourceType,
  PendingContext,
  RegisterContextOptions,
} from "./types"
import { DEFAULT_SOURCE_ORDER } from "./types"
import {
  scoreRelevance,
  type IntentMode as RelevanceIntentMode,
  type Resource as RelevanceResource,
} from "../../shared/relevance-scorer"

const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const CONTEXT_SEPARATOR = "\n\n---\n\n"

function normalizeIntentMode(mode: unknown): RelevanceIntentMode {
  if (typeof mode !== "string") return "default"
  const normalized = mode.toLowerCase()
  if (normalized === "review" || normalized === "research" || normalized === "debug") {
    return normalized
  }
  if (normalized === "implement" || normalized === "implementation" || normalized === "dev") {
    return "implement"
  }
  return "default"
}

function scoreEntryRelevance(entry: ContextEntry): number {
  const metadata = entry.metadata ?? {}
  const resourcePath =
    (typeof metadata.resourcePath === "string" && metadata.resourcePath) ||
    (typeof metadata.filePath === "string" && metadata.filePath) ||
    (typeof metadata.path === "string" && metadata.path)

  if (!resourcePath) {
    return scoreRelevance({ path: entry.id }, "default")
  }

  const resource: RelevanceResource = {
    path: resourcePath,
    type: typeof metadata.resourceType === "string" ? metadata.resourceType : undefined,
  }
  const intent = normalizeIntentMode(metadata.intentMode)
  return scoreRelevance(resource, intent)
}

/**
 * Build source order map from array for O(1) lookups
 */
function buildSourceOrderMap(sourceOrder: ContextSourceType[]): Map<ContextSourceType, number> {
  const map = new Map<ContextSourceType, number>()
  sourceOrder.forEach((source, index) => {
    map.set(source, index)
  })
  return map
}

export interface ContextCollectorOptions {
  /**
   * Custom source order for cache-friendly injection
   * Default: system → directory-agents → directory-readme → rules → skills → dynamic → custom
   */
  sourceOrder?: ContextSourceType[]
}

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()
  private sourceOrderMap: Map<ContextSourceType, number>

  constructor(options?: ContextCollectorOptions) {
    const sourceOrder = options?.sourceOrder ?? DEFAULT_SOURCE_ORDER
    this.sourceOrderMap = buildSourceOrderMap(sourceOrder)
  }

  register(sessionID: string, options: RegisterContextOptions): void {
    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Map())
    }

    const sessionMap = this.sessions.get(sessionID)!
    const key = `${options.source}:${options.id}`

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      metadata: options.metadata,
    }

    sessionMap.set(key, entry)
  }

  getPending(sessionID: string): PendingContext {
    const sessionMap = this.sessions.get(sessionID)

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: "",
        entries: [],
        hasContent: false,
      }
    }

    const entries = this.sortEntries([...sessionMap.values()])
    const merged = entries.map((e) => e.content).join(CONTEXT_SEPARATOR)

    return {
      merged,
      entries,
      hasContent: entries.length > 0,
    }
  }

  consume(sessionID: string): PendingContext {
    const pending = this.getPending(sessionID)
    this.clear(sessionID)
    return pending
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  hasPending(sessionID: string): boolean {
    const sessionMap = this.sessions.get(sessionID)
    return sessionMap !== undefined && sessionMap.size > 0
  }

private sortEntries(entries: ContextEntry[]): ContextEntry[] {
    return entries.sort((a, b) => {
      // First: sort by source order (for cache-friendly injection)
      const sourceOrderA = this.sourceOrderMap.get(a.source) ?? 999
      const sourceOrderB = this.sourceOrderMap.get(b.source) ?? 999
      if (sourceOrderA !== sourceOrderB) return sourceOrderA - sourceOrderB

      // Second: sort by priority within same source
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (priorityDiff !== 0) return priorityDiff

      // Third: sort by relevance score within same source and priority
      const relevanceDiff = scoreEntryRelevance(b) - scoreEntryRelevance(a)
      if (relevanceDiff !== 0) return relevanceDiff

      // Fourth: sort by timestamp within same priority/relevance
      return a.timestamp - b.timestamp
    })
  }
}

export const contextCollector = new ContextCollector()
