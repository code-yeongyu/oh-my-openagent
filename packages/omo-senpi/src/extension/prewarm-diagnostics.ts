import { z } from "zod"
import type { ComponentLogger, SenpiExtensionAPI } from "./types"

interface HandlerRegistration {
  readonly component: string
  readonly source: string
  readonly previewSafe: boolean
}

const skippedEntry = z.object({
  type: z.literal("custom"),
  customType: z.literal("prompt-cache-prewarm"),
  data: z.object({ phase: z.literal("skipped"), reason: z.string() }),
})

const hint = "A before_agent_start handler without previewSafe blocks the prompt-cache prewarm."

/** Per-composition ownership survives late registrations through each component's retained API. */
export function createPrewarmDiagnostics(pi: SenpiExtensionAPI, logger: ComponentLogger) {
  const registrations: HandlerRegistration[] = []
  const warnedSessions = new Set<string>()

  const observe = (_event: unknown, context?: unknown): void => {
    if (typeof context !== "object" || context === null) return
    const manager: unknown = Reflect.get(context, "sessionManager")
    if (typeof manager !== "object" || manager === null) return
    const getEntries: unknown = Reflect.get(manager, "getEntries")
    const getSessionId: unknown = Reflect.get(manager, "getSessionId")
    if (typeof getEntries !== "function" || typeof getSessionId !== "function") return
    const sessionId: unknown = Reflect.apply(getSessionId, manager, [])
    if (typeof sessionId !== "string" || warnedSessions.has(sessionId)) return
    const entries: unknown = Reflect.apply(getEntries, manager, [])
    const parsed = z.array(z.unknown()).safeParse(entries)
    if (!parsed.success) return
    for (const entry of parsed.data) {
      const skipped = skippedEntry.safeParse(entry)
      if (!skipped.success) continue
      warnedSessions.add(sessionId)
      logger.warn(`omo-senpi prompt-cache prewarm skipped. ${hint}`, {
        sessionId, reason: skipped.data.data.reason,
        handlers: registrations.filter(({ previewSafe }) => !previewSafe),
      })
      return
    }
  }

  // Senpi arms prewarm at session_start and runs it on the first draft activity.
  // Read the recorded result at lifecycle edges after that work, never by polling.
  pi.on("resources_discover", observe)
  pi.on("agent_start", observe)
  pi.on("agent_end", observe)
  pi.on("session_shutdown", observe)

  return {
    forComponent(component: string): SenpiExtensionAPI {
      const on: SenpiExtensionAPI["on"] = function on(event, handler, options) {
        if (event === "before_agent_start") {
          const error = new Error()
          Error.captureStackTrace(error, on)
          const registration = {
            component, source: error.stack?.split("\n")[1]?.trim() ?? component,
            previewSafe: options?.previewSafe === true,
          }
          registrations.push(registration)
          if (!registration.previewSafe) {
            logger.warn(`omo-senpi unsafe before_agent_start registration. ${hint}`, registration)
          }
        }
        pi.on(event, handler, options)
      }
      return new Proxy(pi, {
        get(target, property) {
          if (property === "on") return on
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
}
