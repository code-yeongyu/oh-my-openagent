import { readSessionRole } from "@oh-my-opencode/senpi-task"
import type { SenpiExtensionAPI } from "../../extension/types"
import { isRecord, sessionIdFrom } from "./wiring-context"

/** Permission is local to this engine run, never restored from transcript history. */
export function createMemoryUserActivity(env: NodeJS.ProcessEnv = process.env) {
  const accepted = new Set<string>()
  const reconciled = new Set<string>()
  const inFlight = new Map<string, Promise<void>>()
  const inputs = new Map<string, string>()
  return {
    has: (sessionId: string): boolean => accepted.has(sessionId),
    hasReconciled: (sessionId: string): boolean => reconciled.has(sessionId),
    hasInput: (sessionId: string): boolean =>
      accepted.has(sessionId) || inputs.values().some((owner) => owner === sessionId),
    reset(sessionId: string): void {
      accepted.delete(sessionId)
      reconciled.delete(sessionId)
      inFlight.delete(sessionId)
      for (const [inputId, owner] of inputs) if (owner === sessionId) inputs.delete(inputId)
    },
    async reconcileOnce(sessionId: string, reconcile: () => Promise<void>): Promise<void> {
      if (!accepted.has(sessionId) || reconciled.has(sessionId)) return
      const existing = inFlight.get(sessionId)
      if (existing !== undefined) return existing
      const task = Promise.resolve().then(() => {
        if (inFlight.get(sessionId) === task) return reconcile()
      }).then(() => {
        if (inFlight.get(sessionId) === task) reconciled.add(sessionId)
      }).finally(() => {
        if (inFlight.get(sessionId) === task) inFlight.delete(sessionId)
      })
      inFlight.set(sessionId, task)
      await task
    },
    register(pi: SenpiExtensionAPI): void {
      pi.on("input", (payload, eventCtx) => {
        if (readSessionRole(pi, env) !== undefined || !isRecord(payload) || payload.source === "extension"
          || typeof payload.inputId !== "string"
          || typeof payload.text !== "string"
          || (payload.text.trim().length === 0 && (!Array.isArray(payload.images) || payload.images.length === 0))) return
        const sessionId = sessionIdFrom(eventCtx)
        if (sessionId !== undefined) inputs.set(payload.inputId, sessionId)
      })
      pi.on("input_disposition", (payload) => {
        if (!isRecord(payload) || typeof payload.inputId !== "string") return
        const sessionId = inputs.get(payload.inputId)
        inputs.delete(payload.inputId)
        if (sessionId !== undefined && (payload.disposition === "started" || payload.disposition === "queued")) {
          accepted.add(sessionId)
        }
      })
    },
  }
}
