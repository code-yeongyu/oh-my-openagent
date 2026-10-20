import { randomUUID } from "node:crypto"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveMemoryModelRegistry, type ChildModelRegistry } from "../memory/model-registry-resolver"
import {
  ONBOARDING_APPLY_RPC_METHOD,
  ONBOARDING_APPLY_STAGES,
  ONBOARDING_SCAN_RPC_EVENT,
  ONBOARDING_SCAN_RPC_METHOD,
  type OnboardingApplyResponse,
  type OnboardingApplyStage,
  type OnboardingScanResponse,
} from "./scan-contract"
import type { applyMemoryFacts } from "../memory/facts-apply-runtime"
import type { reconcileAppliedFactsBatches } from "../memory/facts-applied-reconcile"
import type { TuiMemoryToolsRuntime } from "./tui-memory-tools"
import type {
  applyRetainedScan,
  claimOnboardingOwned,
  migrationFactsFromScan,
  onboardingScanContext,
  OnboardingScanEnvironment,
  onboardingHistorySummary,
  readOnboardingState,
  runOnboardingScan,
} from "./scan-runtime"
import type { createOnboardingUnderstandingHandlers, OnboardingUnderstandingHandlers } from "./understand-component"
import {
  ONBOARDING_UNDERSTAND_RPC_METHOD,
  ONBOARDING_UNDERSTAND_SKIP_RPC_METHOD,
  ONBOARDING_UNDERSTAND_STOP_RPC_METHOD,
} from "./understand-contract"
import type { OnboardingUnderstandingSeams } from "./understand-start"
import type { runTuiOnboardingScan } from "./tui-scan-runtime"
import type { executeOnboardingSessionHistory } from "./session-history-tool-runtime"

export * from "./scan-contract"
export * from "./understand-contract"

declare const OMO_SENPI_BUNDLED: boolean

/** The built runtime sits beside `omo.js`, so the entry bundle carries none of `omo setup`. */
export const ONBOARDING_SCAN_RUNTIME_FILE = "omo-onboarding-scan.js"
/** Finished scans an apply can still use; older ones answer `unavailable`. */
const RETAINED_SCANS = 8
/** A scan describes the machine only briefly; after this, an apply answers stale instead of writing. */
export const ONBOARDING_SCAN_TTL_MS = 10 * 60_000

export interface OnboardingScanRuntime extends TuiMemoryToolsRuntime {
  readonly runOnboardingScan: typeof runOnboardingScan
  readonly applyRetainedScan: typeof applyRetainedScan
  readonly readOnboardingState: typeof readOnboardingState
  readonly claimOnboardingOwned: typeof claimOnboardingOwned
  readonly migrationFactsFromScan: typeof migrationFactsFromScan
  readonly onboardingScanContext: typeof onboardingScanContext
  readonly createOnboardingUnderstandingHandlers: typeof createOnboardingUnderstandingHandlers
  readonly onboardingHistorySummary: typeof onboardingHistorySummary
  readonly runTuiOnboardingScan: typeof runTuiOnboardingScan
  readonly executeOnboardingSessionHistory: typeof executeOnboardingSessionHistory
  readonly applyMemoryFacts: typeof applyMemoryFacts
  readonly reconcileAppliedFactsBatches: typeof reconcileAppliedFactsBatches
}

/** The engine's own credential store (senpi `AuthStorage`), narrowed to the surface an apply uses. */
export interface OnboardingEngineAuthStore {
  getStoragePath(): string
  modify(provider: string, fn: (current: unknown) => unknown | Promise<unknown>): Promise<unknown>
}

export interface OnboardingScanComponentDependencies {
  readonly runtime?: () => OnboardingScanEnvironment
  readonly loadRuntime?: () => Promise<OnboardingScanRuntime>
  readonly understanding?: OnboardingUnderstandingSeams
  /** The engine's credential store apply writes through; defaults to the one `session_start` reports. */
  readonly authStore?: () => OnboardingEngineAuthStore | undefined
  readonly now?: () => number
  /** Where finished scans wait for their apply; defaults to the one store every session of the process shares. */
  readonly scanStore?: OnboardingScanStore
}

type Scan = Promise<Awaited<ReturnType<typeof runOnboardingScan>> | undefined>
interface HeldScan {
  outcome: Scan
  finishedAt: number | undefined
}

/**
 * Retained scans and the last engine credential store, held for the whole engine process: a client
 * may scan on one control session and apply on the next, so nothing here may live per session.
 */
export interface OnboardingScanStore {
  readonly scans: Map<string, HeldScan>
  /** Scans with an understanding run in progress, whichever session started it. */
  readonly understanding: Map<string, symbol>
  latestAuthStore: OnboardingEngineAuthStore | undefined
}

export function createOnboardingScanStore(): OnboardingScanStore {
  return { scans: new Map(), understanding: new Map(), latestAuthStore: undefined }
}

const processScanStore = createOnboardingScanStore()
/**
 * `omo.onboarding.scan` / `omo.onboarding.apply`: `omo setup`'s detection streamed to RPC clients
 * and its writers run on their consent. Programmatic only: no model is read or called, no socket is
 * opened, and nothing is written before an apply names its stages.
 */
export function createOnboardingScanComponent(deps: OnboardingScanComponentDependencies = {}): OmoSenpiComponent {
  return {
    name: "onboarding-scan",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const handle = pi.rpc?.handle
      if (handle === undefined) return
      const environment = deps.runtime ?? (() => ({}))
      const loadRuntime = deps.loadRuntime ?? loadOnboardingScanRuntime
      const now = deps.now ?? (() => Date.now())
      const shared = deps.scanStore ?? processScanStore
      const scans = shared.scans
      let modelRegistry: ChildModelRegistry | undefined
      // The engine's own AuthStorage (modelRegistry.authStorage): an apply's credential writes go
      // through its lock, so a token refresh that lands mid-apply is merged, never reverted. A
      // session that captured none (a fresh control session) uses the one the process captured last.
      let capturedStore: OnboardingEngineAuthStore | undefined
      const authStore = deps.authStore ?? (() => capturedStore ?? shared.latestAuthStore)
      if (typeof pi.on === "function") {
        pi.on("session_start", (_payload, eventCtx) => {
          modelRegistry = resolveMemoryModelRegistry(eventCtx) ?? modelRegistry
          const registry = isRecord(eventCtx) && isRecord(eventCtx["modelRegistry"]) ? eventCtx["modelRegistry"] : undefined
          const candidate = isRecord(registry?.["authStorage"]) ? registry?.["authStorage"] : undefined
          if (
            candidate !== undefined && typeof candidate["getStoragePath"] === "function" && typeof candidate["modify"] === "function"
          ) {
            capturedStore = candidate as unknown as OnboardingEngineAuthStore
            shared.latestAuthStore = capturedStore
          }
        })
      }
      const expired = (entry: Pick<HeldScan, "finishedAt">): boolean => entry.finishedAt !== undefined && now() - entry.finishedAt > ONBOARDING_SCAN_TTL_MS
      // Understanding's handlers ship in the lazy runtime: the first understanding call loads them, once
      // per shell (concurrent first calls share one load), so its runs map scopes skip and stop. A failed
      // load is not kept; the next call retries.
      let understandingHandlers: Promise<OnboardingUnderstandingHandlers> | undefined
      const understanding = async (): Promise<OnboardingUnderstandingHandlers | string> => {
        const pending = understandingHandlers ??= loadRuntime().then((runtime) => runtime.createOnboardingUnderstandingHandlers(pi, understandingDeps))
        try {
          return await pending
        } catch (error) {
          if (understandingHandlers === pending) understandingHandlers = undefined
          return `The onboarding runtime could not load: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      const understandingDeps: Parameters<typeof createOnboardingUnderstandingHandlers>[1] = {
        environment,
        modelRegistry: () => modelRegistry,
        busyScans: shared.understanding,
        scans,
        expired,
        ...(deps.understanding === undefined ? {} : { seams: deps.understanding }),
      }
      const delegate = (pick: (handlers: OnboardingUnderstandingHandlers) => (request: unknown) => unknown) =>
        async (request: unknown): Promise<unknown> => {
          const handlers = await understanding()
          return typeof handlers === "string" ? { kind: "unavailable", reason: handlers } : await pick(handlers)(request)
        }
      handle(ONBOARDING_UNDERSTAND_RPC_METHOD, delegate((handlers) => handlers.understand))
      handle(ONBOARDING_UNDERSTAND_SKIP_RPC_METHOD, delegate((handlers) => handlers.skip))
      handle(ONBOARDING_UNDERSTAND_STOP_RPC_METHOD, delegate((handlers) => handlers.stop))

      handle(ONBOARDING_SCAN_RPC_METHOD, (request): OnboardingScanResponse => {
        const scanId = randomUUID()
        const includeCustomProviders = isRecord(request) && request["includeCustomProviders"] === true
        const held: HeldScan = { outcome: Promise.resolve(undefined), finishedAt: undefined }
        // The client learns the id from this response, so no event may precede it. The clock is
        // read when the final `done` event is emitted - inside the scan - so an apply racing in
        // right after the events never sees a stale-or-missing finish time.
        const emit = (event: unknown): void => {
          if (isRecord(event) && event["kind"] === "done") {
            held.finishedAt = now()
            // Release the scan, digests included, once it has expired even if no later call prunes it.
            setTimeout(() => {
              if (scans.get(scanId) === held) scans.delete(scanId)
            }, ONBOARDING_SCAN_TTL_MS).unref?.()
          }
          pi.rpc?.emit(ONBOARDING_SCAN_RPC_EVENT, event)
        }
        held.outcome = new Promise((resolve) => setTimeout(resolve, 0))
          .then(loadRuntime)
          .then((runtime) => runtime.runOnboardingScan(environment(), { scanId, includeCustomProviders }, emit))
          .catch((error: unknown) => {
            emit({ scanId, kind: "done", source: "all", elapsedMs: 0, reason: error instanceof Error ? error.message : String(error) })
            return undefined
          })
        scans.set(scanId, held)
        for (const [id, entry] of scans) {
          if (entry !== held && expired(entry)) scans.delete(id)
        }
        const retained = [...scans.keys()].filter((id) => {
          const entry = scans.get(id)
          return entry?.finishedAt !== undefined || id === scanId
        })
        for (const id of retained.slice(0, Math.max(0, retained.length - RETAINED_SCANS))) scans.delete(id)
        return { scanId }
      })

      handle(ONBOARDING_APPLY_RPC_METHOD, async (request): Promise<OnboardingApplyResponse> => {
        const scanId = isRecord(request) ? request["scanId"] : undefined
        const stages = isRecord(request) ? request["stages"] : undefined
        if (typeof scanId !== "string" || !Array.isArray(stages)) return { kind: "invalid", reason: "apply needs a scanId and a stages list" }
        const unknown = stages.filter((stage) => !isApplyStage(stage))
        if (unknown.length > 0) return { kind: "invalid", reason: `unknown stages: ${unknown.map(String).join(", ")}` }
        const held = scans.get(scanId)
        if (held === undefined) return { kind: "unavailable", reason: "No scan with this id; it finished long ago or was already applied." }
        // One apply per scan: its plans describe the files as they were when the scan read them.
        scans.delete(scanId)
        const plans = await held.outcome
        if (plans === undefined) return { kind: "unavailable", reason: "The scan failed before it planned anything." }
        if (held.finishedAt === undefined || expired(held)) {
          return { kind: "stale", reason: "The scan expired; retained scans live ten minutes. Run omo.onboarding.scan again.", paths: [] }
        }
        // Everything past the expiry check needs the runtime, so it ships there: the auth checks and the writers.
        // The scan was taken out of the store above, synchronously, so two applies racing on one scan never both run.
        return await (await loadRuntime()).applyRetainedScan(scanId, plans.plans, stages.filter(isApplyStage), authStore)
      })
    },
  }
}

function isApplyStage(value: unknown): value is OnboardingApplyStage {
  return ONBOARDING_APPLY_STAGES.some((stage) => stage === value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function loadOnboardingScanRuntime(): Promise<OnboardingScanRuntime> {
  const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED
  const loaded: unknown = await import(new URL(bundled ? ONBOARDING_SCAN_RUNTIME_FILE : "scan-runtime.ts", import.meta.url).href)
  if (!isRecord(loaded)) throw new Error("onboarding scan runtime did not load")
  const missing = RUNTIME_EXPORTS.filter((name) => typeof loaded[name] !== "function")
  if (missing.length > 0) throw new Error(`onboarding scan runtime is missing ${missing.join(", ")}`)
  return loaded as unknown as OnboardingScanRuntime
}

const RUNTIME_EXPORTS: readonly (keyof OnboardingScanRuntime)[] = [
  "runOnboardingScan",
  "migrationFactsFromScan",
  "applyRetainedScan",
  "createOnboardingUnderstandingHandlers",
  "onboardingHistorySummary",
  "onboardingScanContext",
  "readOnboardingState",
  "claimOnboardingOwned",
  "runTuiOnboardingScan",
  "executeOnboardingSessionHistory",
  "applyMemoryFacts",
  "reconcileAppliedFactsBatches",
  "executeOnboardingUnderstand",
  "executeOnboardingMemoryApply",
]
