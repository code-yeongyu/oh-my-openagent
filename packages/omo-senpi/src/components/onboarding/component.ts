import type { ExtensionContext, SessionStartEvent } from "@code-yeongyu/senpi"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot, getOmoNativeStateDir } from "../telemetry/product-identity"
import { readAgentEndOutcome } from "../ulw-execute-continuation/agent-end-eligibility"
import { claimOnboarding, isOnboardingComplete, releaseOnboarding } from "./state"

export interface OnboardingComponentDependencies {
  claimOnboarding(stateDir: string): boolean
  isOnboardingComplete(stateDir: string): boolean
  releaseOnboarding(stateDir: string): void
}

const defaultDependencies: OnboardingComponentDependencies = {
  claimOnboarding,
  isOnboardingComplete,
  releaseOnboarding,
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
  let forcedConsumed = false
  return {
    name: "onboarding",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const stateDir = getOmoNativeStateDir(process.env)
      const tour = `Read ${getBuiltinSkillsRoot()}/onboarding/SKILL.md and follow it.`
      const force = () => pi.getFlag("onboard") === true && !forcedConsumed
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
          "Welcome to OmO. Ask for anything.",
          "Put ulw in a prompt for the full workflow.",
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
      const claim = (ctx: ExtensionContext, forced: boolean): boolean => {
        if (pending !== undefined) return false
        const owned = dependencies.claimOnboarding(stateDir)
        if (!owned && !forced) return false
        forcedConsumed ||= forced
        pending = { id: ctx.sessionManager.getSessionId(), owned, active: false }
        if (ctx.mode === "tui") ctx.ui.setWidget("omo-onboarding", undefined)
        return true
      }

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
        if (!claim(ctx, true)) return
        try {
          await pi.sendMessage({
            customType: "omo-onboarding:bootstrap",
            content: `${tour} Greet first.`,
            display: false,
          }, { triggerTurn: true, deliverAs: "followUp" })
        } catch (error) {
          release(ctx)
          throw error
        }
      })

      // Deliberately not previewSafe: previews must never acquire install-wide state.
      pi.on("before_agent_start", (event, ctx) => {
        if (!isRecord(event) || event.trigger !== "prompt" || event.preview === true || !eligible(ctx)) return
        const forced = force()
        if (!claim(ctx, forced)) return
        if (ctx.sessionManager.getBranch().some((entry) =>
          entry.type === "custom_message" && entry.customType === "omo-onboarding:context")) return
        pi.appendEntry?.("omo-onboarding:started", { reason: "first-prompt", forced })
        return {
          message: {
            customType: "omo-onboarding:context",
            display: false,
            content: forced
              ? `${tour} Include their message in the tour.`
              : `Answer fully, greet in their language, offer a one-line tour. If accepted or requested: ${tour}`,
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
        else pending = null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
