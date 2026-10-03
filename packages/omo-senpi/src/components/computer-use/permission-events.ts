import { CHILD_PERMISSION_EVENT, parseChildExtensionEvent, readSessionAncestry, type ChildExtensionEvent } from "@oh-my-opencode/senpi-task"
import * as z from "zod"
import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { computerUseSessionId } from "../telemetry/omo-native-computer-use"

export const TASK_CHILD_EXTENSION_EVENT = "omo.task.child_extension_event"
const ROOT_PERMISSION_EVENT = "omo.computer.permission_required"
const PERMISSION_LATCHES = Symbol.for("omo.computer.permissionLatches")
const forwardedSchema = z.object({
  parent_session_id: z.string(),
  root_session_id: z.string(),
  event: z.unknown(),
})

const localLatches = (() => {
  const seen = new Map<string, Set<ChildExtensionEvent["permission"]>>()
  return Object.freeze({
    version: 1,
    claim(root: string, permission: ChildExtensionEvent["permission"]): boolean {
      const permissions = seen.get(root) ?? new Set<ChildExtensionEvent["permission"]>()
      if (permissions.has(permission)) return false
      permissions.add(permission)
      seen.set(root, permissions)
      return true
    },
  })
})()

function permissionClaim(): typeof localLatches.claim {
  try {
    const retained: unknown = Object.getOwnPropertyDescriptor(globalThis, PERMISSION_LATCHES)?.value
    const facade = typeof retained === "object" && retained !== null && Object.isFrozen(retained)
      && "version" in retained && retained.version === 1 && "claim" in retained && typeof retained.claim === "function"
      ? retained : localLatches
    Object.defineProperty(globalThis, PERMISSION_LATCHES, {
      value: facade, writable: false, configurable: false, enumerable: false,
    })
    const claim = facade.claim
    if (typeof claim !== "function") return localLatches.claim
    return (root, permission) => {
      try {
        const claimed: unknown = claim(root, permission)
        if (typeof claimed === "boolean") return claimed
      } catch {
        return localLatches.claim(root, permission)
      }
      return localLatches.claim(root, permission)
    }
  } catch {
    // A hostile retained slot must not replace the caller's native permission denial.
    return localLatches.claim
  }
}

/** Root identity belongs to session_start, never to a shared tool's in-process child context. */
export function wireComputerPermissionEvents(pi: SenpiExtensionAPI, env: NodeJS.ProcessEnv, logger: ComponentLogger) {
  const claim = permissionClaim()
  let sessionId: string | undefined
  let unsubscribe: (() => void) | undefined
  const report = (permission: Omit<ChildExtensionEvent, "type">): void => {
    if (sessionId === undefined || pi.rpc === undefined) return
    const event: ChildExtensionEvent = { type: CHILD_PERMISSION_EVENT, ...permission }
    if (readSessionAncestry(pi, env) !== undefined) {
      pi.rpc.emit(CHILD_PERMISSION_EVENT, event)
      return
    }
    if (!claim(sessionId, event.permission)) return
    const data = { session_id: sessionId, permission: event.permission, ...(event.app === undefined ? {} : { app: event.app }) }
    pi.rpc.emit(ROOT_PERMISSION_EVENT, data)
    try {
      pi.appendEntry?.(ROOT_PERMISSION_EVENT, { session_id: sessionId, permission: event.permission })
    } catch (error) {
      logger.warn("Computer permission event emitted, but its session marker could not be persisted.", error)
    }
  }
  pi.on("session_start", (_payload, context) => {
    sessionId = computerUseSessionId(context)
    if (sessionId === undefined) return
    // Do NOT replay persisted permission markers into the claim latch. The process-global
    // facade already dedupes a denial within this process (across extension reloads). A marker
    // written by a previous process only ever matters when the session resumes in a NEW process,
    // which is exactly when suppression is wrong: the grant may have been revoked since (re-sign,
    // TCC reset, user toggle), so a fresh denial must prompt again. Cross-process resume falls
    // back to re-prompting, which is the safe default.
    unsubscribe?.()
    unsubscribe = pi.events?.on(TASK_CHILD_EXTENSION_EVENT, (value) => {
      const parsed = forwardedSchema.safeParse(value)
      if (!parsed.success || parsed.data.parent_session_id !== sessionId) return
      const root = readSessionAncestry(pi, env)?.rootSessionId ?? sessionId
      if (parsed.data.root_session_id !== root) return
      const event = parseChildExtensionEvent(parsed.data.event)
      if (event !== undefined) report(event)
    })
  })
  pi.on("session_shutdown", () => {
    unsubscribe?.()
    unsubscribe = undefined
    sessionId = undefined
  })
  return report
}
