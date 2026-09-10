import { join } from "node:path"

import type { ExtensionContext, SessionStartEvent } from "@code-yeongyu/senpi"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import {
  isExtensionContext,
  isSessionStartEvent,
} from "../onboarding/component"
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
      pi.on("session_start", (rawPayload: unknown, rawEventCtx: unknown) => {
        if (!isSessionStartEvent(rawPayload)) return
        const payload: SessionStartEvent = rawPayload
        if (payload.reason !== "startup") return
        if (!isExtensionContext(rawEventCtx)) return
        const eventCtx: ExtensionContext = rawEventCtx
        void runAdvisor(pi, ctx, eventCtx, dependencies.runAfterPreflight).catch((error) => {
          ctx.logger.warn("init-deep-advisor failed", { error })
        })
      })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
