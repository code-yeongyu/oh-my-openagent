import type { SenpiExtensionAPI } from "../../extension/types"
import type { ChildModelRegistry } from "../memory/model-registry-resolver"
import type { OnboardingScanEnvironment } from "./scan-runtime"
import type { SessionDigest } from "./session-history"
import {
  ONBOARDING_UNDERSTAND_RPC_EVENT,
  type OnboardingUnderstandControlResponse,
  type OnboardingUnderstandEvent,
  type OnboardingUnderstandResponse,
} from "./understand-contract"
import { startOnboardingUnderstanding, type OnboardingUnderstandingSeams, type OnboardingUnderstandingStarted } from "./understand-start"

/** A retained scan as the shell holds it: the outcome carries its in-memory digests and the project roots it listed. */
export interface OnboardingRetainedScan {
  readonly outcome: Promise<{ readonly digests: readonly SessionDigest[]; readonly projectRoots: ReadonlySet<string> } | undefined>
  readonly finishedAt: number | undefined
}

export interface OnboardingUnderstandRegistration {
  readonly environment: () => OnboardingScanEnvironment
  readonly modelRegistry: () => ChildModelRegistry | undefined
  /** Shared by every session of the process: one understanding per scan at a time. */
  readonly busyScans: Map<string, symbol>
  /** The shell's retained scans: an expired one is dropped here, an evicted or applied one is already gone. */
  readonly scans: Map<string, OnboardingRetainedScan>
  readonly expired: (scan: OnboardingRetainedScan) => boolean
  readonly seams?: OnboardingUnderstandingSeams
}

const MODEL_SELECTOR = /^[^/\s]+\/\S+$/

/** The three understanding RPC answers; the shell registers the method names and delegates here. */
export interface OnboardingUnderstandingHandlers {
  readonly understand: (request: unknown) => Promise<OnboardingUnderstandResponse>
  readonly skip: (request: unknown) => OnboardingUnderstandControlResponse
  readonly stop: (request: unknown) => OnboardingUnderstandControlResponse
}

/**
 * Ships in the lazy onboarding-scan sidecar with the rest of understanding, so `omo.js` carries only
 * the method names. One instance per registered shell: its runs map scopes skip and stop.
 */
export function createOnboardingUnderstandingHandlers(pi: SenpiExtensionAPI, deps: OnboardingUnderstandRegistration): OnboardingUnderstandingHandlers {
  const runs = new Map<string, OnboardingUnderstandingStarted["control"]>()
  const { busyScans, scans } = deps
  // The digests exist only in memory, with the retained scan: an expired, evicted or applied scan has none.
  const scanForUnderstanding = async (scanId: string) => {
    const held = scans.get(scanId)
    const outcome = await held?.outcome
    if (held === undefined || outcome === undefined || scans.get(scanId) !== held) return undefined
    if (held.finishedAt === undefined || deps.expired(held)) {
      scans.delete(scanId)
      return undefined
    }
    return { digests: outcome.digests, projectRoots: outcome.projectRoots }
  }

  const understand = async (request: unknown): Promise<OnboardingUnderstandResponse> => {
    if (!isRecord(request) || request["consent"] !== true) {
      return { kind: "invalid", reason: "Understanding sends the scan's session digests and each scanned project's AGENTS.md to the model provider, so it needs consent: true." }
    }
    const scanId = request["scanId"]
    const model = request["model"]
    if (typeof scanId !== "string" || scanId.length === 0) return { kind: "invalid", reason: "understand needs the scanId of a scan" }
    if (typeof model !== "string" || !MODEL_SELECTOR.test(model)) return { kind: "invalid", reason: "model must be provider/model" }
    const modelRegistry = deps.modelRegistry()
    if (modelRegistry === undefined) return { kind: "unavailable", reason: "No session has started yet, so no model is available." }
    if (busyScans.has(scanId)) return { kind: "invalid", reason: "An understanding run is already in progress for this scan; stop it or wait for its done event." }
    const token = Symbol(scanId)
    busyScans.set(scanId, token)
    const release = (): void => {
      if (busyScans.get(scanId) === token) busyScans.delete(scanId)
    }
    let started: Awaited<ReturnType<typeof startOnboardingUnderstanding>> | undefined
    try {
      const scan = await scanForUnderstanding(scanId)
      if (scan === undefined) {
        return { kind: "unavailable", reason: "No retained scan with this id: it never ran, failed, expired after ten minutes, or was applied. Run omo.onboarding.scan again." }
      }
      const environment = deps.environment()
      const emit = (event: OnboardingUnderstandEvent): void => {
        if (event.kind === "done") release()
        pi.rpc?.emit(ONBOARDING_UNDERSTAND_RPC_EVENT, event)
      }
      started = await startOnboardingUnderstanding({
        scanId,
        model,
        digests: scan.digests,
        projectRoots: scan.projectRoots,
        modelRegistry,
        ...(environment.env === undefined ? {} : { env: environment.env }),
        ...(deps.seams === undefined ? {} : { seams: deps.seams }),
      }, emit)
    } finally {
      if (started === undefined || "kind" in started) release()
    }
    if ("kind" in started) return started
    const { understandId, control: running, finished } = started
    runs.set(understandId, running)
    void finished.finally(() => {
      runs.delete(understandId)
      release()
    })
    return { understandId }
  }

  const control = (request: unknown, act: (run: OnboardingUnderstandingStarted["control"], body: Readonly<Record<string, unknown>>) => string | undefined): OnboardingUnderstandControlResponse => {
    const understandId = isRecord(request) ? request["understandId"] : undefined
    if (!isRecord(request) || typeof understandId !== "string") return { kind: "invalid", reason: "needs an understandId" }
    const run = runs.get(understandId)
    if (run === undefined) return { kind: "unavailable", reason: "No running understanding with this id." }
    const invalid = act(run, request)
    return invalid === undefined ? { understandId, accepted: true } : { kind: "invalid", reason: invalid }
  }
  return {
    understand,
    skip: (request) => control(request, (run, body) => {
      const project = body["project"]
      if (typeof project !== "string" || project.length === 0) return "skip needs a project directory"
      run.skip(project)
      return undefined
    }),
    stop: (request) => control(request, (run) => {
      run.stop()
      return undefined
    }),
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
