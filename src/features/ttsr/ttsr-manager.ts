import picomatch from "picomatch"
import { matchesScope, parseScope } from "./scope-parser"
import type { TtsrEntry, TtsrMatchContext, TtsrRule, TtsrSettings } from "./types"

interface InjectionRecord {
  lastInjectedAt: number
}

export class TtsrManager {
  readonly #settings: TtsrSettings
  readonly #rules: Map<string, TtsrEntry> = new Map()
  readonly #buffers: Map<string, string> = new Map()
  readonly #injectionRecords: Map<string, InjectionRecord> = new Map()
  #messageCount = 0

  constructor(settings: TtsrSettings) {
    this.#settings = settings
  }

  addRule(rule: TtsrRule): void {
    const conditions: RegExp[] = []
    for (const condition of rule.condition) {
      try {
        conditions.push(new RegExp(condition))
      } catch {
        continue
      }
    }

    if (conditions.length === 0) {
      return
    }

    const scope = parseScope(rule.scope)
    const globalPathGlobs = this.#createGlobalPathMatcher(rule)

    this.#rules.set(rule.name, {
      rule,
      conditions,
      scope,
      globalPathGlobs,
    })
  }

  checkDelta(delta: string, context: TtsrMatchContext): TtsrRule[] {
    if (!this.#settings.enabled) {
      return []
    }

    const updatedBuffer = this.#appendBuffer(delta, context)
    const matches: TtsrRule[] = []

    for (const [name, entry] of this.#rules) {
      if (!matchesScope(entry.scope, context)) {
        continue
      }

      if (!this.#matchesGlobalPathGlobs(entry, context)) {
        continue
      }

      if (!this.#canTrigger(name)) {
        continue
      }

      if (!this.#matchesAnyCondition(entry.conditions, updatedBuffer)) {
        continue
      }

      matches.push(entry.rule)
    }

    return matches
  }

  markInjected(ruleNames: string[]): void {
    for (const ruleName of ruleNames) {
      this.#injectionRecords.set(ruleName, { lastInjectedAt: this.#messageCount })
    }
  }

  resetBuffer(): void {
    this.#buffers.clear()
  }

  incrementMessageCount(): void {
    this.#messageCount += 1
  }

  restoreInjected(names: string[]): void {
    for (const name of names) {
      this.#injectionRecords.set(name, { lastInjectedAt: 0 })
    }
  }

  getInjectedRuleNames(): string[] {
    return Array.from(this.#injectionRecords.keys())
  }

  #createGlobalPathMatcher(rule: TtsrRule): ReturnType<typeof picomatch> | undefined {
    if (!rule.globs || rule.globs.length === 0) {
      return undefined
    }
    return picomatch(rule.globs)
  }

  #appendBuffer(delta: string, context: TtsrMatchContext): string {
    const bufferKey = this.#getBufferKey(context)
    const currentBuffer = this.#buffers.get(bufferKey) ?? ""
    const updatedBuffer = currentBuffer + delta
    this.#buffers.set(bufferKey, updatedBuffer)
    return updatedBuffer
  }

  #matchesGlobalPathGlobs(entry: TtsrEntry, context: TtsrMatchContext): boolean {
    if (!entry.globalPathGlobs || !context.filePaths) {
      return true
    }

    for (const filePath of context.filePaths) {
      if (entry.globalPathGlobs(filePath)) {
        return true
      }
    }

    return false
  }

  #matchesAnyCondition(conditions: RegExp[], text: string): boolean {
    for (const condition of conditions) {
      condition.lastIndex = 0
      if (condition.test(text)) {
        return true
      }
    }

    return false
  }

  #canTrigger(ruleName: string): boolean {
    const record = this.#injectionRecords.get(ruleName)
    if (!record) {
      return true
    }

    if (this.#settings.repeatMode === "once") {
      return false
    }

    return this.#messageCount - record.lastInjectedAt >= this.#settings.repeatGap
  }

  #getBufferKey(context: TtsrMatchContext): string {
    if (context.source === "text") {
      return "text"
    }

    if (context.source === "thinking") {
      return "thinking"
    }

    if (context.source === "tool") {
      if (context.streamKey) {
        return `toolcall:${context.streamKey}`
      }

      if (context.toolName) {
        return `tool:${context.toolName}`
      }

      return "tool"
    }

    return context.source
  }
}
