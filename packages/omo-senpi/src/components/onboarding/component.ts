import type { ExtensionContext, SessionStartEvent } from "@code-yeongyu/senpi"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot, getOmoNativeStateDir } from "../telemetry/product-identity"
import { readAgentEndOutcome } from "../ulw-execute-continuation/agent-end-eligibility"
import { loadOnboardingScanRuntime } from "./scan-component"
import type { OnboardingScanEnvironment } from "./scan-runtime"
import { registerSessionHistoryRpc } from "./session-history-rpc"
import { createOnboardingSessionHistoryTool } from "./session-history-tool"
import type { ClaimOwnerSeams } from "./claim-owner"
import {
  claimOnboarding,
  completeOnboarding,
  isOnboardingComplete,
  isOnboardingCompletionRecorded,
  releaseOnboarding,
  resetOnboarding,
} from "./state"
import { registerOnboardingStateRpc } from "./state-rpc"
import type { OnboardingUnderstandingSeams } from "./understand-start"
import { createOnboardingMemoryTools, type TuiOnboardingScan } from "./tui-memory-tools"

export interface OnboardingComponentDependencies {
  claimOnboarding(stateDir: string, claimOwnerSeams?: ClaimOwnerSeams): boolean | Promise<boolean>
  isOnboardingComplete(stateDir: string): boolean
  releaseOnboarding(stateDir: string): void
  /** Records a finished onboarding; omitted, a finished TUI turn records nothing (test fakes). */
  completeOnboarding?(stateDir: string): void
  /** Clears claim and completion for `omo.onboarding.state.reset`; defaults to `state.ts`. */
  resetOnboarding?(stateDir: string): void
  /** Where the migration inventory's scan reads; defaults to what `omo setup` reads. */
  readonly scanEnvironment?: () => OnboardingScanEnvironment
  /** The whole inventory source; defaults to the shared scan runtime `omo setup` uses. */
  readonly migrationFacts?: () => Promise<string | undefined>
  /** The whole scan; defaults to the shared onboarding scan. `undefined` onboards without one. */
  readonly scan?: () => Promise<TuiScanResult | undefined>
  /** Fake-model seams for the understanding the TUI runs. */
  readonly understanding?: OnboardingUnderstandingSeams
  /** Identity readers for claim owners; defaults to the real process table. */
  readonly claimOwnerSeams?: ClaimOwnerSeams
  /** Install-wide state dir; defaults to the engine's. */
  readonly stateDir?: string
  /** The bounded background summary of this machine's agent sessions; defaults to the scan runtime's. */
  readonly sessionHistory?: () => Promise<string | undefined>
}

export interface TuiScanResult extends TuiOnboardingScan {
  /** Scan rows and value summary, computed from this scan's events. */
  readonly context: string
  readonly inventory?: string
}

// The scan runs in the lazy onboarding-scan runtime (`tui-scan-runtime.ts`), so the TUI never grows a
// second config reader. Fail-open: a scan that cannot run onboards the user without it.
async function defaultScan(environment: OnboardingScanEnvironment, sessions: boolean): Promise<TuiScanResult> {
  return (await loadOnboardingScanRuntime()).runTuiOnboardingScan(environment, { sessions })
}

const defaultDependencies: OnboardingComponentDependencies = {
  claimOnboarding: claimWithOwner,
  completeOnboarding,
  isOnboardingComplete,
  releaseOnboarding,
  resetOnboarding,
}

// The owner-recording claim (pid + start identity, dead-owner takeover) ships in the onboarding-scan
// sidecar; it loads only on an install without a recorded completion. A sidecar that cannot load falls
// back to the plain claim, which still keeps two sessions from onboarding at once.
async function claimWithOwner(stateDir: string, seams?: ClaimOwnerSeams): Promise<boolean> {
  if (isOnboardingCompletionRecorded(stateDir)) return false
  let runtime
  try {
    runtime = await loadOnboardingScanRuntime()
  } catch {
    return claimOnboarding(stateDir)
  }
  return runtime.claimOnboardingOwned(stateDir, seams)
}

export function isSessionStartEvent(v: unknown): v is SessionStartEvent {
  return isRecord(v) && "reason" in v
}

export function isExtensionContext(v: unknown): v is ExtensionContext {
  return isRecord(v) && "ui" in v
}

export function createOnboardingComponent(
  dependencies: OnboardingComponentDependencies = defaultDependencies,
): OmoSenpiComponent {
  const forcedKey = Symbol.for("omo.onboard")
  const processState = globalThis as { [forcedKey]?: boolean }
  return {
    name: "onboarding",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const stateDir = dependencies.stateDir ?? getOmoNativeStateDir(process.env)
      const tour = `Follow ${getBuiltinSkillsRoot()}/onboarding/SKILL.md.`
      const scanEnvironment = dependencies.scanEnvironment ?? (() => ({}))
      // The first onboarding turn awaits only `omo setup`'s sources (sessions: false): its rows, value
      // summary and migration inventory. Session digests are read by a second scan that starts only
      // when onboarding_understand runs, after consent. Each runs once per process, never at register(),
      // and only a success is kept: a failed run answers undefined and the next call retries it.
      const inventoryScan = onceUntilSuccess(dependencies.scan ?? (() => defaultScan(scanEnvironment(), false)))
      const understandingScan = onceUntilSuccess(dependencies.scan ?? (() => defaultScan(scanEnvironment(), true)))
      // An injected inventory replaces the scan's; the default scan then never starts for it.
      const injectedFacts = dependencies.migrationFacts
      const injected = injectedFacts === undefined ? undefined : onceUntilSuccess(injectedFacts)
      // Session history is never awaited: it starts with the claim, runs bounded in the background and
      // rides the next turn when it lands; a hang or failure just leaves it out until the next claim.
      const history = onceUntilSuccess(async () => {
        const content = await (dependencies.sessionHistory
          ?? (async () => (await loadOnboardingScanRuntime()).onboardingHistorySummary(scanEnvironment())))()
        if (content !== undefined && pending !== undefined) {
          await pi.sendMessage({ customType: "omo-onboarding:history", content, display: false }, { deliverAs: "nextTurn" })
        }
      })
      const withInventory = async (base: string): Promise<string> => {
        void history()
        const result = injectedFacts !== undefined && dependencies.scan === undefined ? undefined : await inventoryScan()
        const facts = injected === undefined
          ? result?.inventory
          : await injected()
        const parts = [base]
        if (facts !== undefined) parts.push(` Migration inventory (from the same scan omo setup runs): ${facts}`)
        if (result !== undefined) parts.push(`\n\n${result.context}`)
        return parts.join("")
      }
      const force = () => pi.getFlag("onboard") === true && !processState[forcedKey]
      // Undefined is unclaimed; null is a successfully completed onboarding turn.
      let pending: {
        id: string
        owned: boolean
        active: boolean
        end?: unknown
      } | null | undefined

      const eligible = (ctx: unknown): ctx is ExtensionContext =>
        isExtensionContext(ctx) && ctx.hasUI && pi.sessionKind === "interactive"
        && pi.getFlag("omo-senpi-onboarding-disabled") !== true

      const showWelcome = (ctx: ExtensionContext): void => {
        if (ctx.mode !== "tui") return
        ctx.ui.setWidget("omo-onboarding", [
          "Welcome to OmO. Ask anything.",
          "Use ulw for full workflows.",
        ])
      }
      const ownsRun = (ctx: unknown): ctx is ExtensionContext =>
        isExtensionContext(ctx) && pending != null
        && ctx.sessionManager.getSessionId() === pending.id

      const release = (ctx: ExtensionContext): void => {
        if (pending?.owned) dependencies.releaseOnboarding(stateDir)
        pending = undefined
        if (eligible(ctx) && !dependencies.isOnboardingComplete(stateDir)) showWelcome(ctx)
      }
      let claiming = false
      const claim = async (ctx: ExtensionContext, forced: boolean): Promise<boolean> => {
        if (pending !== undefined || claiming) return false
        claiming = true
        let owned: boolean
        try {
          owned = await dependencies.claimOnboarding(stateDir, dependencies.claimOwnerSeams)
        } finally {
          claiming = false
        }
        if (!owned && !forced) return false
        processState[forcedKey] ||= forced
        pending = { id: ctx.sessionManager.getSessionId(), owned, active: false }
        if (ctx.mode === "tui") ctx.ui.setWidget("omo-onboarding", undefined)
        return true
      }

      pi.registerTool({ ...createOnboardingSessionHistoryTool({ stateDir }) })
      const memoryTools = createOnboardingMemoryTools({
        scan: understandingScan,
        loadRuntime: loadOnboardingScanRuntime,
        ...(dependencies.understanding === undefined ? {} : { seams: dependencies.understanding }),
      })
      pi.registerTool({ ...memoryTools.understand })
      pi.registerTool({ ...memoryTools.apply })
      registerOnboardingStateRpc(pi, {
        stateDir,
        completeOnboarding: dependencies.completeOnboarding ?? completeOnboarding,
        resetOnboarding: dependencies.resetOnboarding ?? resetOnboarding,
        onReset: () => { pending = undefined },
        ...(dependencies.claimOwnerSeams === undefined ? {} : { claimOwnerSeams: dependencies.claimOwnerSeams }),
      })
      registerSessionHistoryRpc(pi)

      pi.registerFlag("onboard", {
        type: "boolean",
        default: false,
        description: "Start the guided tour.",
      })

      pi.on("session_start", async (event, ctx) => {
        if (!isSessionStartEvent(event) || event.reason !== "startup"
          || !eligible(ctx) || ctx.mode !== "tui") return
        if (!force()) {
          if (!dependencies.isOnboardingComplete(stateDir)) showWelcome(ctx)
          return
        }
        if (!(await claim(ctx, true))) return
        try {
          await pi.sendMessage({
            customType: "omo-onboarding:bootstrap",
            content: await withInventory(`${tour} Greet first.`),
            display: false,
          }, { triggerTurn: true, deliverAs: "followUp" })
        } catch (error) {
          release(ctx)
          throw error
        }
      })

      // Deliberately not previewSafe: previews must never acquire install-wide state.
      pi.on("before_agent_start", async (event, ctx) => {
        if (!isRecord(event) || event.trigger !== "prompt" || event.preview === true || !eligible(ctx)) return
        const forced = force()
        if (!(await claim(ctx, forced))) return
        if (ctx.sessionManager.getBranch().some((entry) =>
          entry.type === "custom_message" && entry.customType === "omo-onboarding:context")) return
        return {
          message: {
            customType: "omo-onboarding:context",
            display: false,
            content: await withInventory(forced
              ? `${tour} Tour using their message.`
              : `Answer fully; greet in their language; offer a one-line tour. On request/acceptance: ${tour}`),
          },
        }
      })

      pi.on("agent_start", (_event, ctx) => {
        if (ownsRun(ctx) && pending) {
          pending.active = true
          pending.end = undefined
        }
      })
      pi.on("agent_end", (event, ctx) => {
        if (!ownsRun(ctx) || !pending?.active) return
        pending.end = event
        const outcome = readAgentEndOutcome(event)
        if (!outcome.willRetry && outcome.blockedBy !== null) release(ctx)
      })
      pi.on("agent_settled", (_event, ctx) => {
        if (!ownsRun(ctx) || !pending?.active) return
        // The host can join a late user abort onto the same agent_end object.
        if (readAgentEndOutcome(pending.end).blockedBy !== null) release(ctx)
        else {
          pending = null
          try {
            dependencies.completeOnboarding?.(stateDir)
          } catch {
            // Fail-open like the claim: the held claim still keeps this install from re-onboarding.
          }
        }
      })
      pi.on("input_disposition", (event, ctx) => {
        if (ownsRun(ctx) && pending && !pending.active
          && isRecord(event) && event.disposition === "rejected") release(ctx)
      })
      for (const event of ["session_abort", "session_shutdown"]) {
        pi.on(event, (_event, ctx) => {
          if (ownsRun(ctx)) release(ctx)
        })
      }
    },
  }
}

// Concurrent callers share one in-flight run and a success is kept for the process; a rejected run
// answers undefined to everyone waiting on it and is dropped, so the next call starts a fresh one.
function onceUntilSuccess<T>(run: () => Promise<T>): () => Promise<T | undefined> {
  let kept: Promise<T> | undefined
  return () => {
    const current = kept ??= Promise.resolve().then(run)
    return current.catch(() => {
      if (kept === current) kept = undefined
      return undefined
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
