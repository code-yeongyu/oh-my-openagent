import { join } from "node:path"

import type { ExtensionContext } from "@code-yeongyu/senpi"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { isExtensionContext } from "../onboarding/component"
import { getOnboardingMarkerMtime } from "../onboarding/state"
import { getOmoNativeStateDir } from "../telemetry/product-identity"
import { gitToplevel } from "./git-helpers"
import type { AdvisorPreflight } from "./runtime"

declare const OMO_SENPI_BUNDLED: boolean

const RUNTIME_FILE_NAME = "omo-init-deep-advisor.js"

type AdvisorRunner = (
  pi: SenpiExtensionAPI,
  eventCtx: ExtensionContext,
  preflight: AdvisorPreflight,
) => Promise<void>

export interface InitDeepAdvisorComponentDependencies {
  readonly runAfterPreflight: AdvisorRunner
}

const defaultDependencies: InitDeepAdvisorComponentDependencies = {
  runAfterPreflight: runBundledAdvisorAfterPreflight,
}

export const processStartTime: number = Date.now()

export function createInitDeepAdvisorComponent(
  dependencies: InitDeepAdvisorComponentDependencies = defaultDependencies,
): OmoSenpiComponent {
  return {
    name: "init-deep-advisor",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const attempted = new Set<string>()
      pi.on("before_agent_start", (rawPayload: unknown, rawEventCtx: unknown) => {
        if (!isFirstRealPrompt(rawPayload)) return
        if (!isExtensionContext(rawEventCtx)) return
        const eventCtx: ExtensionContext = rawEventCtx
        const sessionKey = advisorSessionKey(eventCtx)
        if (attempted.has(sessionKey)) return
        attempted.add(sessionKey)
        // The advisor used to run on session_start with reason "startup", which every senpi RPC
        // open_session also reports with hasUI, so a host app's background sessions (model
        // probes, auth, prepared drafts) spawned git, stat'ed the onboarding marker, and could
        // open a dialog in a session nobody sees. Like onboarding after the #2197 fix, it now
        // waits for the first real prompt in an interactive session: a session that opens and
        // closes without one never runs any advisor work, and a preview, an extension-triggered
        // turn, or a delivery never consumes the session's one attempt. The run itself stays
        // deferred off the dispatch path, so the dialog never blocks the prompt that armed it.
        deferUntilAfterFirstPaint(ctx, "init-deep-advisor", () => {
          void runAdvisor(pi, ctx, eventCtx, dependencies.runAfterPreflight).catch((error) => {
            ctx.logger.warn("init-deep-advisor failed", { error })
          })
        })
      }, { previewSafe: true })
    },
  }
}

export async function runAdvisor(
  pi: SenpiExtensionAPI,
  _ctx: ComponentContext,
  eventCtx: ExtensionContext,
  runner: AdvisorRunner = runBundledAdvisorAfterPreflight,
): Promise<void> {
  const preflight = advisorPreflight(pi, eventCtx)
  if (preflight === null) return
  await runner(pi, eventCtx, preflight)
}

async function runBundledAdvisorAfterPreflight(
  pi: SenpiExtensionAPI,
  eventCtx: ExtensionContext,
  preflight: AdvisorPreflight,
): Promise<void> {
  const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED
  await runAdvisorRuntime(pi, eventCtx, preflight, bundled ? RUNTIME_FILE_NAME : "runtime.ts")
}

async function runAdvisorRuntime(
  pi: SenpiExtensionAPI,
  eventCtx: ExtensionContext,
  preflight: AdvisorPreflight,
  fileName: string,
): Promise<void> {
  const loaded: unknown = await import(new URL(fileName, import.meta.url).href)
  if (!isRecord(loaded)) throw new Error("init-deep-advisor runtime did not load")
  const runner = loaded["runAdvisorAfterPreflight"]
  if (typeof runner !== "function") {
    throw new Error("init-deep-advisor runtime is missing runAdvisorAfterPreflight")
  }
  await Reflect.apply(runner, undefined, [pi, eventCtx, preflight])
}

function advisorPreflight(
  pi: SenpiExtensionAPI,
  eventCtx: ExtensionContext,
): AdvisorPreflight | null {
  if (!eventCtx.hasUI) return null
  // The onboarding entry rule from the #2197 fix: only an interactive session can show and
  // answer the advisor. Hosts that report no session kind fail closed, as in onboarding.
  if (pi.sessionKind !== "interactive") return null
  if (pi.getFlag("omo-senpi-init-deep-advisor-disabled") === true) return null
  const onboardingStateDir = getOmoNativeStateDir(process.env)
  const stateDir = join(onboardingStateDir, "init-deep-advisor-state")
  const cwd = eventCtx.cwd ?? process.cwd()
  const root = gitToplevel(cwd)
  if (root === null) return null
  const markerMtime = getOnboardingMarkerMtime(onboardingStateDir)
  if (markerMtime === null || markerMtime >= processStartTime) return null
  return { root, stateDir }
}

function isFirstRealPrompt(value: unknown): boolean {
  return isRecord(value) && value["trigger"] === "prompt" && value["preview"] !== true
}

function advisorSessionKey(eventCtx: ExtensionContext): string {
  const getSessionId = eventCtx.sessionManager?.getSessionId
  if (typeof getSessionId === "function") {
    const sessionId: unknown = Reflect.apply(getSessionId, eventCtx.sessionManager, [])
    if (typeof sessionId === "string" && sessionId.length > 0) return sessionId
  }
  return eventCtx.cwd ?? process.cwd()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
