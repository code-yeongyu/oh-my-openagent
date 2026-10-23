import type * as ProcessIsolationRuntimeModule from "#omo-process-isolation-runtime"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

/** The guard implementation, loaded from its own sidecar on first registration (issue #6123). */
export type ProcessIsolationRuntime = typeof ProcessIsolationRuntimeModule

export interface ProcessIsolationComponentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly resolveSessionId?: (eventContext: unknown) => string | undefined
  /** Imports the guard; the default is `#omo-process-isolation-runtime`, resolved to the sidecar. */
  readonly loadRuntime?: () => Promise<ProcessIsolationRuntime>
}

function sessionIdFrom(eventContext: unknown): string | undefined {
  if (typeof eventContext !== "object" || eventContext === null) return undefined
  const manager = Reflect.get(eventContext, "sessionManager")
  if (typeof manager !== "object" || manager === null) return undefined
  const getSessionId = Reflect.get(manager, "getSessionId")
  if (typeof getSessionId !== "function") return undefined
  const sessionId = Reflect.apply(getSessionId, manager, [])
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function readBashCall(payload: unknown): { command: string; input: object } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  if (Reflect.get(payload, "toolName") !== "bash") return undefined
  const input = Reflect.get(payload, "input")
  if (typeof input !== "object" || input === null) return undefined
  const command = Reflect.get(input, "command")
  return typeof command === "string" && command.trim().length > 0 ? { command, input } : undefined
}

/**
 * Session-scoped process isolation for the `bash` tool (issue #6123).
 *
 * Each command is exported with `OMO_PROCESS_SCOPE=<session>` before it runs, so its whole process
 * tree (Playwright workers, dev servers, test runners) carries the owning session. When a command
 * signals processes, the target's tag is read back: a process owned by a different session blocks
 * the command instead of being killed as if it were this session's timed-out child. Untagged
 * processes stay allowed and `OMO_PROCESS_ISOLATION=off` is the per-command escape hatch.
 */
export function createProcessIsolationComponent(options: ProcessIsolationComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "process-isolation",
    async register(pi: SenpiExtensionAPI, ctx: ComponentContext): Promise<void> {
      const env = options.env ?? process.env
      const resolveSessionId = options.resolveSessionId ?? sessionIdFrom
      let runtime: ProcessIsolationRuntime
      try {
        runtime = await (options.loadRuntime ?? (() => import("#omo-process-isolation-runtime")))()
      } catch (error) {
        ctx.logger.warn("omo-senpi process-isolation runtime failed to load; cross-session kills are not guarded", {
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }

      pi.on("tool_call", (payload: unknown, eventContext: unknown): unknown => {
        const call = readBashCall(payload)
        if (call === undefined) return undefined
        if ((env[runtime.ISOLATION_ENV] ?? "").trim().toLowerCase() === "off") return undefined
        if (runtime.optsOut(call.command)) return undefined

        const sessionId = resolveSessionId(eventContext)
        if (sessionId === undefined) return undefined
        const scope = runtime.processScope(sessionId)

        const allow = (): undefined => {
          Reflect.set(call.input, "command", runtime.scopeCommand(call.command, scope))
          return undefined
        }

        return runtime.processIsolationVerdict(call.command, scope).then((reason) => {
          if (reason === undefined) return allow()
          ctx.logger.debug?.("omo-senpi process-isolation blocked a cross-session termination", {
            sessionId,
            reason,
          })
          return { block: true, reason }
        }, (error: unknown) => {
          ctx.logger.warn("omo-senpi process-isolation guard failed; allowing the command", {
            error: error instanceof Error ? error.message : String(error),
          })
          return allow()
        })
      })
    },
  }
}
