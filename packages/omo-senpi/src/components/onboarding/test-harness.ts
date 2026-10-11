import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOnboardingComponent } from "./component"
import * as state from "./state"

class OnboardingAPI extends FakeExtensionAPI {
  sessionKind: "interactive" | "worker" = "interactive"
}

export function createOnboardingHarness(dir: string, sessionId = "session", mode = "rpc") {
  const pi = new OnboardingAPI()
  const widgets = new Map<string, string[]>()
  const ctx = {
    hasUI: true,
    mode,
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      setWidget(key: string, lines: string[] | undefined) {
        if (lines) widgets.set(key, lines)
        else widgets.delete(key)
      },
    },
  }
  const dependencies = {
    claimOnboarding: () => state.claimOnboarding(dir),
    isOnboardingComplete: () => state.isOnboardingComplete(dir),
    releaseOnboarding: () => state.releaseOnboarding(dir),
  }
  createOnboardingComponent(dependencies).register(pi, {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: () => false },
  })
  return {
    pi, ctx, widgets,
    start: () => pi.dispatch("session_start", { type: "session_start", reason: "startup" }, ctx),
    prompt: (overrides: Record<string, unknown> = {}) => pi.dispatch("before_agent_start", {
      type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test", ...overrides,
    }, ctx),
    agentStart: () => pi.dispatch("agent_start", { type: "agent_start" }, ctx),
    end: (stopReason = "stop", overrides: Record<string, unknown> = {}) => pi.dispatch("agent_end", {
      type: "agent_end", messages: [{ role: "assistant", stopReason, content: [] }], ...overrides,
    }, ctx),
    settle: () => pi.dispatch("agent_settled", { type: "agent_settled" }, ctx),
  }
}
