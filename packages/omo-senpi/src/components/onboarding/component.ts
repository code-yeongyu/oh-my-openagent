import type { ExtensionContext, SessionStartEvent } from "@code-yeongyu/senpi"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot, getOmoNativeStateDir } from "../telemetry/product-identity"
import { claimOnboarding } from "./state"

export interface OnboardingComponentDependencies {
  claimOnboarding(stateDir: string): boolean
}

const defaultDependencies: OnboardingComponentDependencies = {
  claimOnboarding,
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
  let onboardConsumed = false

  return {
    name: "onboarding",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const stateDir = getOmoNativeStateDir(process.env)
      const skillsRoot = getBuiltinSkillsRoot()

      pi.registerFlag("onboard", {
        type: "boolean",
        default: false,
        description: "Force the onboarding flow on startup.",
      })

      pi.on("session_start", (rawPayload: unknown, rawEventCtx: unknown) => {
        if (!isSessionStartEvent(rawPayload)) return
        const payload: SessionStartEvent = rawPayload
        if (payload.reason !== "startup") return
        if (!isExtensionContext(rawEventCtx)) return
        const eventCtx: ExtensionContext = rawEventCtx
        // Onboarding starts a turn of its own. sendCustomMessage never registers into
        // bindExtensions' prompt-readiness set, so on a headless surface (senpi -p / --mode json)
        // that turn begins underneath print mode, whose own bare prompt is then rejected with
        // "Agent is already processing" and exits 1. Gate on an interactive surface exactly as the
        // sibling init-deep-advisor does, and gate BEFORE claiming so a headless first run cannot
        // burn the once-per-install marker the user's first interactive session is owed.
        if (!eventCtx.hasUI) return
        if (pi.getFlag("omo-senpi-onboarding-disabled") === true) return
        const force = pi.getFlag("onboard") === true
        if (force && onboardConsumed) return
        if (!force) {
          if (!dependencies.claimOnboarding(stateDir)) return
        }
        pi.sendMessage({
          customType: "omo-onboarding:bootstrap",
          content: `Read the onboarding skill at ${skillsRoot}/onboarding/SKILL.md with the read tool and follow it. Greet the user first.`,
          display: false,
        }, { triggerTurn: true, deliverAs: "followUp" })
        if (force) onboardConsumed = true
        pi.appendEntry?.("omo-onboarding:started", { reason: payload.reason, forced: force })
      })
    },
  }
}
