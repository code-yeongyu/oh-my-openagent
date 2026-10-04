import { resolveMemoryIdentity, resolveMemoryRoot } from "@oh-my-opencode/memory-core"
import type { ComponentContext } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { GatewayScopeAccess } from "../gateway/scope-access"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryBinding, findLatestMemoryBinding, type SessionEntryLike } from "./binding"
import { logBindReconcileFailure } from "./bind-reconcile-log"
import { adoptSessionIdentity } from "./identity-adoption"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { MemoryExtensionAPI } from "./capabilities"
import { resolveMemorySettings } from "./identity-runtime"
import { memoryModuleSupervisor } from "./supervisor"
import { isOneShotSurface, resolveIdentityRunPaths, type IdentityRunPaths } from "./transient-identity"
import type { MemoryWiring } from "./wiring-types"

export type SessionUi = { notify(message: string, level: "error" | "warning"): void }
export type SessionSurface = {
  readonly entries: readonly SessionEntryLike[]
  readonly id: string
  readonly ui?: SessionUi
  readonly hasUI?: boolean
  /** The session's own working directory, reported by the host per event. */
  readonly cwd?: string
}
export type SessionState = {
  readonly enabled: boolean
  readonly ui?: SessionUi
  context?: MemoryIdentityContext
  /** Where this session's identity storage lives; finalized (transient root reclaimed) at shutdown. */
  run?: IdentityRunPaths
  memoryStatusAttempted: boolean
  restartNotified: boolean
  conflictNotified: boolean
  scopeIdentity?: string
  scopePromptReset?: boolean
}

export function createMemorySessionBinder(input: {
 readonly loadConfig: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
 readonly now: () => number
 readonly env: Record<string, string | undefined>
 readonly cwd: string
 readonly scopeAccess: GatewayScopeAccess
 readonly sessions: Map<string, SessionState>
 readonly ctx: ComponentContext
 readonly pi: MemoryExtensionAPI
 readonly wiring: MemoryWiring
 readonly enabled: (config: ReturnType<typeof resolveMemorySettings>) => boolean
}) {
 const { loadConfig, now, env, cwd, scopeAccess, sessions, ctx, pi, wiring } = input
      const bindSession = async (
        surface: SessionSurface,
        eventCtx: unknown,
        options: { readonly existing: SessionState | undefined; readonly verifyRepository: boolean },
      ): Promise<void> => {
        const sessionConfig = resolveMemorySettings(loadConfig({ cwd }).config.memory)
        const state: SessionState = options.existing ?? {
          enabled: input.enabled(sessionConfig),
          memoryStatusAttempted: false,
          restartNotified: false,
          conflictNotified: false,
          ...(surface.ui === undefined ? {} : { ui: surface.ui }),
        }
        sessions.set(surface.id, state)
        if (!state.enabled) return

        // The identity belongs to the SESSION's workspace, not to whatever directory the host
        // process happens to sit in: one shared host serves sessions from many workspaces (#8556).
        const sessionCwd = surface.cwd ?? cwd
        const memoryRoot = resolveMemoryRoot(env, sessionCwd)
        const member = await scopeAccess.member(surface.id)
        const scopeMemory = member?.role === "lead" ? scopeAccess.identity(member, sessionCwd) : undefined
        const scopeIdentity = scopeMemory?.id
        const scope = member?.role === "lead" && scopeMemory !== undefined ? member.scope : undefined
        const resolved = scopeMemory ?? resolveMemoryIdentity(sessionConfig.agent, sessionCwd, env)
        const recorded = findLatestMemoryBinding(surface.entries)
        const hint = recorded === undefined ? undefined : Reflect.get(recorded, "gatewayScope")
        const recordedScope = typeof hint === "string" ? hint : undefined
        const previous = scopeIdentity !== undefined ? undefined : findLatestMemoryBinding(surface.entries.filter((entry) =>
          entry.data === null || typeof entry.data !== "object" || typeof Reflect.get(entry.data, "gatewayScope") !== "string",
        ))
        state.scopePromptReset = (recordedScope !== undefined || scope !== undefined)
          && (recordedScope !== scope || recorded?.identity !== scopeIdentity)
        state.scopeIdentity = scopeIdentity
        const adoption = adoptSessionIdentity({
          recorded: previous,
          resolved,
          memoryRoot,
          configAgentValue: scopeIdentity ?? sessionConfig.agent,
          verifyRepository: options.verifyRepository,
        })
        if (adoption.kind === "conflict") {
          if (!state.conflictNotified) {
            state.conflictNotified = true
            surface.ui?.notify(
              `memory identity conflict: session is bound to ${previous?.identity}, but config resolved ${resolved.id}; restart with the original identity or fork a new session`,
              "error",
            )
            ctx.logger.warn("omo-senpi memory binding failed closed", {
              sessionId: surface.id,
              bound: previous?.identity,
              resolved: resolved.id,
            })
          }
          return
        }
        const identity = adoption.identity
        if (adoption.kind === "rebound") {
          ctx.logger.info("omo-senpi memory identity rebound to the session binding", {
            sessionId: surface.id,
            bound: identity.id,
            resolved: resolved.id,
          })
        }
        const binding = createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: now() })

        const run = resolveIdentityRunPaths({
          identity: identity.id,
          identityPaths: identity.paths,
          memoryRoot,
          oneShot: scopeIdentity === undefined && isOneShotSurface({ hasUI: surface.hasUI, env, pi }),
        })
        state.run = run
        state.context = createMemoryIdentityContext({
          identity: identity.id,
          identityPaths: run.paths,
          durableRoot: run.durableRoot,
          binding,
        })
        memoryModuleSupervisor.acquire()
        pi.appendEntry(MEMORY_BINDING_CUSTOM_TYPE, scope === undefined ? binding : { ...binding, gatewayScope: scope })
        // Bind-time reconcile floats past the bind by design, but its rejection must not
        // float: an unhandled rejection is attributed to whatever code is running when it lands.
        void wiring.afterBind(pi, surface.id, state.context, eventCtx).catch((error: unknown) => {
          logBindReconcileFailure(ctx.logger, error)
        })
      }

 return bindSession
}
