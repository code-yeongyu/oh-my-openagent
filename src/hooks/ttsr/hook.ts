import { TtsrManager } from "../../features/ttsr/ttsr-manager"
import type { TtsrMatchContext, TtsrRule, TtsrSettings } from "../../features/ttsr/types"
import { log } from "../../shared/logger"

export interface TtsrHookDeps {
  settings: TtsrSettings
  rules: TtsrRule[]
  onMatch: (sessionID: string, matchedRules: TtsrRule[]) => Promise<void>
}

export interface TtsrHook {
  handleEvent(event: { type: string }, props: Record<string, unknown>): Promise<void>
  getManager(sessionID: string): TtsrManager | undefined
  addRulesToExistingManagers(rules: TtsrRule[]): void
}

export function createTtsrHook(deps: TtsrHookDeps): TtsrHook {
  const managers = new Map<string, TtsrManager>()
  const partOffsets = new Map<string, number>()

  function getOrCreateManager(sessionID: string): TtsrManager {
    let manager = managers.get(sessionID)
    if (!manager) {
      manager = new TtsrManager(deps.settings)
      for (const rule of deps.rules) {
        manager.addRule(rule)
      }
      managers.set(sessionID, manager)
    }
    return manager
  }

  async function handleEvent(event: { type: string }, props: Record<string, unknown>): Promise<void> {
    const info = props?.info as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionID = (info?.id ?? info?.sessionID) as string | undefined
      if (sessionID) {
        getOrCreateManager(sessionID)
        log("[ttsr] Session created, TtsrManager initialized", { sessionID })
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionID = (info?.id ?? info?.sessionID) as string | undefined
      if (sessionID) {
        managers.delete(sessionID)
        for (const key of partOffsets.keys()) {
          if (key.startsWith(`${sessionID}:`)) {
            partOffsets.delete(key)
          }
        }
        log("[ttsr] Session deleted, TtsrManager cleaned up", { sessionID })
      }
      return
    }

    if (event.type === "message.updated") {
      const sessionID = info?.sessionID as string | undefined
      if (!sessionID) {
        return
      }
      const manager = managers.get(sessionID)
      if (manager) {
        manager.resetBuffer()
        manager.incrementMessageCount()
      }
      return
    }

    if (event.type === "message.part.updated") {
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined
      const part = info?.part as Record<string, unknown> | undefined

      if (!sessionID || role !== "assistant" || !part) {
        return
      }

      if (part.type !== "text") {
        return
      }

      const manager = managers.get(sessionID)
      if (!manager) {
        return
      }

      const partID = part.id as string | undefined
      const fullText = (part.text ?? "") as string
      const deltaFromEvent = props?.delta as string | undefined

      let delta: string
      if (deltaFromEvent !== undefined) {
        delta = deltaFromEvent
      } else if (partID) {
        const offsetKey = `${sessionID}:${partID}`
        const lastOffset = partOffsets.get(offsetKey) ?? 0
        delta = fullText.slice(lastOffset)
        partOffsets.set(offsetKey, fullText.length)
      } else {
        delta = fullText
      }

      if (!delta) {
        return
      }

      const context: TtsrMatchContext = { source: "text" }
      const matches = manager.checkDelta(delta, context)

      if (matches.length > 0) {
        log("[ttsr] Pattern matched, triggering abort-retry", {
          sessionID,
          rules: matches.map((rule) => rule.name),
        })
        await deps.onMatch(sessionID, matches)
      }
      return
    }
  }

  return {
    handleEvent,
    getManager: (sessionID) => managers.get(sessionID),
    addRulesToExistingManagers: (newRules) => {
      for (const manager of managers.values()) {
        for (const rule of newRules) {
          manager.addRule(rule)
        }
      }
    },
  }
}
