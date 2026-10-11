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
  return typeof v === "object" && v !== null && "reason" in v
}

export function isExtensionContext(v: unknown): v is ExtensionContext {
  return typeof v === "object" && v !== null && "ui" in v
}

export function createOnboardingComponent(
  dependencies: OnboardingComponentDependencies = defaultDependencies,
): OmoSenpiComponent {
  return {
    name: "onboarding",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const stateDir = getOmoNativeStateDir(process.env)
      const skillsRoot = getBuiltinSkillsRoot()
      let consumed = false
      let pending: {
        sessionId: string
        ownsMarker: boolean
        active: boolean
        outcome?: unknown
      } | undefined

      const eligible = (ctx: unknown): ctx is ExtensionContext =>
        isExtensionContext(ctx) && ctx.hasUI && pi.sessionKind === "interactive"
        && pi.getFlag("omo-senpi-onboarding-disabled") !== true

      const showWelcome = (ctx: ExtensionContext): void => {
        if (ctx.mode !== "tui") return
        ctx.ui.setWidget("omo-onboarding", [
          "Welcome to OmO. Ask for anything.",
          "Put ulw in a prompt for the full workflow. Ask for the tour to get started.",
        ])
      }
      const ownsRun = (ctx: unknown): ctx is ExtensionContext =>
        isExtensionContext(ctx) && pending !== undefined
        && ctx.sessionManager.getSessionId() === pending.sessionId

      const release = (ctx: ExtensionContext): void => {
        if (pending?.ownsMarker) dependencies.releaseOnboarding(stateDir)
        pending = undefined
        consumed = false
        if (eligible(ctx) && !dependencies.isOnboardingComplete(stateDir)) showWelcome(ctx)
      }
      const claim = (ctx: ExtensionContext, forced: boolean): boolean => {
        if (consumed) return false
        const ownsMarker = dependencies.claimOnboarding(stateDir)
        if (!ownsMarker && !forced) return false
        consumed = true
        pending = { sessionId: ctx.sessionManager.getSessionId(), ownsMarker, active: false }
        if (ctx.mode === "tui") ctx.ui.setWidget("omo-onboarding", undefined)
        return true
      }

      pi.registerFlag("onboard", {
        type: "boolean",
        default: false,
        description: "Force the onboarding flow on startup.",
      })

      pi.on("session_start", async (event, ctx) => {
        if (!isSessionStartEvent(event) || event.reason !== "startup"
          || !eligible(ctx) || ctx.mode !== "tui") return
        if (pi.getFlag("onboard") !== true) {
          if (!dependencies.isOnboardingComplete(stateDir)) showWelcome(ctx)
          return
        }
        if (!claim(ctx, true)) return
        pi.appendEntry?.("omo-onboarding:started", { reason: "startup", forced: true })
        try {
          await pi.sendMessage({
            customType: "omo-onboarding:bootstrap",
            content: `Read the onboarding skill at ${skillsRoot}/onboarding/SKILL.md with the read tool and follow it. Greet the user first.`,
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
        const forced = pi.getFlag("onboard") === true
        if (!claim(ctx, forced)) return
        pi.appendEntry?.("omo-onboarding:started", { reason: "first-prompt", forced })
        return {
          message: {
            customType: "omo-onboarding:context",
            display: false,
            content: forced
              ? `The user explicitly requested onboarding with --onboard. Read ${skillsRoot}/onboarding/SKILL.md and run the guided tour, incorporating their message.`
              : `This is the user's first message to OmO. Do what they asked first, fully. Then greet them in their language and offer the tour in one line. If they accept, read ${skillsRoot}/onboarding/SKILL.md and follow it. If their message itself asks for a tour or getting started, follow the skill now.`,
          },
        }
      })

      pi.on("agent_start", (_event, ctx) => {
        if (ownsRun(ctx) && pending) {
          pending.active = true
          pending.outcome = undefined
        }
      })
      pi.on("agent_end", (event, ctx) => {
        if (!ownsRun(ctx) || !pending?.active) return
        pending.outcome = event
        const outcome = readAgentEndOutcome(event)
        if (!outcome.willRetry && outcome.blockedBy !== null) release(ctx)
      })
      pi.on("agent_settled", (_event, ctx) => {
        if (!ownsRun(ctx) || !pending?.active) return
        // The host can join a late user abort onto the same agent_end object.
        if (readAgentEndOutcome(pending.outcome).blockedBy !== null) release(ctx)
        else pending = undefined
      })
      pi.on("input_disposition", (event, ctx) => {
        if (ownsRun(ctx) && pending && !pending.active
          && isRecord(event) && event.disposition === "rejected") release(ctx)
      })
      pi.on("session_abort", (_event, ctx) => {
        if (ownsRun(ctx)) release(ctx)
      })
      pi.on("session_shutdown", (_event, ctx) => {
        if (ownsRun(ctx)) release(ctx)
      })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
