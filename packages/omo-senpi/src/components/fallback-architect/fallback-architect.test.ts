/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { FALLBACK_ARCHITECT_DIRECTIVE_TYPE, FALLBACK_ARCHITECT_REMINDER_TYPE } from "./directive"
import { createFallbackArchitectComponent } from "./index"
import { FALLBACK_ARCHITECT_NOTICE_TYPE } from "./notice"

const FABLE = { provider: "anthropic", id: "claude-fable-5" }
const OPUS = { provider: "anthropic", id: "claude-opus-5" }
const KIMI = { provider: "kimi-coding", id: "kimi-k3-unlocked" }
const DISABLED_FLAG = "omo-senpi-fallback-architect-disabled"

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  return { logger, config: { getFlag: (name) => pi.getFlag(name) } }
}

async function setup(options: { architect?: boolean; disabled?: boolean } = {}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  if (options.disabled === true) pi.setFlag(DISABLED_FLAG, true)
  const component = createFallbackArchitectComponent({
    hasArchitectCategory: () => options.architect !== false,
  })
  await component.register(pi, createTestContext(pi))
  return pi
}

function refusalMessage(): Record<string, unknown> {
  return { role: "assistant", stopReason: "error", stopDetails: { type: "refusal" } }
}

function policyRejectionMessage(): Record<string, unknown> {
  return {
    role: "assistant",
    stopReason: "error",
    errorMessage: "This request triggered restrictions on request content and was blocked under Anthropic's Usage Policy.",
  }
}

async function endMessage(pi: FakeExtensionAPI, message: unknown): Promise<void> {
  await pi.dispatch("message_end", { type: "message_end", message }, { cwd: "/tmp/project" })
}

async function selectModel(
  pi: FakeExtensionAPI,
  input: { model: unknown; previousModel?: unknown; source: string },
): Promise<void> {
  await pi.dispatch("model_select", { type: "model_select", ...input }, { cwd: "/tmp/project" })
}

async function sendInput(pi: FakeExtensionAPI, source = "interactive"): Promise<unknown> {
  const [result] = await pi.dispatch("input", { type: "input", text: "next question", source }, { cwd: "/tmp/project" })
  return result
}

async function sendQueuedInput(pi: FakeExtensionAPI, streamingBehavior: string): Promise<unknown> {
  const [result] = await pi.dispatch(
    "input",
    { type: "input", text: "next question", source: "interactive", streamingBehavior },
    { cwd: "/tmp/project" },
  )
  return result
}

function directives(pi: FakeExtensionAPI): Record<string, unknown>[] {
  return pi.messages.map((call) => call.message).filter((m) => m["customType"] === FALLBACK_ARCHITECT_DIRECTIVE_TYPE)
}

function reminders(pi: FakeExtensionAPI): Record<string, unknown>[] {
  return pi.messages.map((call) => call.message).filter((m) => m["customType"] === FALLBACK_ARCHITECT_REMINDER_TYPE)
}

function notices(pi: FakeExtensionAPI): Record<string, unknown>[] {
  return pi.messages.map((call) => call.message).filter((m) => m["customType"] === FALLBACK_ARCHITECT_NOTICE_TYPE)
}

describe("fallback-architect component", () => {
  describe("#given a classifier refusal on claude-fable-5", () => {
    describe("#when the session falls back to a weaker model", () => {
      it("#then it injects exactly one hidden directive naming both models", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })

        const injected = directives(pi)
        expect(injected).toHaveLength(1)
        expect(injected[0]?.["display"]).toBe(false)
        expect(String(injected[0]?.["content"])).toContain("anthropic/claude-fable-5")
        expect(String(injected[0]?.["content"])).toContain("anthropic/claude-opus-5")
        expect(String(injected[0]?.["content"])).toContain('task(category: "architect")')
      })

      it("#then it also shows exactly one visible notice with structured model details", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })

        const shown = notices(pi)
        expect(shown).toHaveLength(1)
        expect(shown[0]?.["display"]).toBe(true)
        expect(String(shown[0]?.["content"])).toContain("anthropic/claude-opus-5")
        expect(shown[0]?.["details"]).toEqual({
          from: "anthropic/claude-fable-5",
          to: "anthropic/claude-opus-5",
        })
      })

      it("#then it registers a renderer for the visible notice message", async () => {
        const pi = await setup()
        expect(pi.messageRenderers.map((registration) => registration.customType)).toContain(FALLBACK_ARCHITECT_NOTICE_TYPE)
      })
    })
  })

  describe("#given a provider policy rejection with no stopDetails", () => {
    describe("#when the session falls back", () => {
      it("#then it still injects the directive", async () => {
        const pi = await setup()
        await endMessage(pi, policyRejectionMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(directives(pi)).toHaveLength(1)
      })
    })
  })

  describe("#given a fallback that no refusal preceded", () => {
    describe("#when a transient failure moves the session off fable 5", () => {
      it("#then nothing is injected", async () => {
        const pi = await setup()
        await endMessage(pi, { role: "assistant", stopReason: "error", errorMessage: "Request timed out." })
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(pi.messages).toHaveLength(0)
        expect(notices(pi)).toHaveLength(0)
      })
    })

    describe("#when a successful answer precedes the fallback", () => {
      it("#then the stale refusal flag does not survive", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await endMessage(pi, { role: "assistant", stopReason: "stop" })
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(pi.messages).toHaveLength(0)
      })
    })
  })

  describe("#given a refusal on a model that is not fable 5", () => {
    describe("#when the session falls back", () => {
      it("#then nothing is injected", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: KIMI, previousModel: OPUS, source: "fallback" })
        expect(pi.messages).toHaveLength(0)
      })
    })
  })

  describe("#given the architect category is unavailable", () => {
    describe("#when a refusal fallback happens", () => {
      it("#then nothing is injected", async () => {
        const pi = await setup({ architect: false })
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(pi.messages).toHaveLength(0)
        expect(notices(pi)).toHaveLength(0)
      })
    })
  })

  describe("#given the default gate and a live model registry in the event context", () => {
    describe("#when a refusal fallback happens", () => {
      it("#then the gate receives the registry from the event context", async () => {
        const pi = new FakeExtensionAPI()
        let seenRegistry: unknown
        const registry = { getAvailable: () => [FABLE], find: () => FABLE }
        const component = createFallbackArchitectComponent({
          hasArchitectCategory: (_cwd: string, gateRegistry?: unknown) => {
            seenRegistry = gateRegistry
            return true
          },
        })
        await component.register(pi, createTestContext(pi))
        await endMessage(pi, refusalMessage())
        await pi.dispatch(
          "model_select",
          { type: "model_select", model: OPUS, previousModel: FABLE, source: "fallback" },
          { cwd: "/tmp/project", modelRegistry: registry },
        )
        expect(seenRegistry).toBe(registry)
        expect(directives(pi)).toHaveLength(1)
      })

      it("#then a context without a registry still gates on config alone", async () => {
        const pi = new FakeExtensionAPI()
        let seenRegistry: unknown
        const component = createFallbackArchitectComponent({
          hasArchitectCategory: (_cwd: string, gateRegistry?: unknown) => {
            seenRegistry = gateRegistry
            return true
          },
        })
        await component.register(pi, createTestContext(pi))
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(seenRegistry).toBeUndefined()
        expect(directives(pi)).toHaveLength(1)
      })
    })
  })

  describe("#given the component is disabled by flag", () => {
    describe("#when a refusal fallback happens and the user prompts again", () => {
      it("#then neither the directive nor a reminder is injected", async () => {
        const pi = await setup({ disabled: true })
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        await sendInput(pi)
        expect(pi.messages).toHaveLength(0)
      })
    })
  })

  describe("#given an active refusal fallback", () => {
    describe("#when the user sends further prompts", () => {
      it("#then each prompt carries exactly one reminder and the input is never rewritten", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })

        const first = await sendInput(pi)
        const second = await sendInput(pi)

        expect(first).toEqual({ action: "continue" })
        expect(second).toEqual({ action: "continue" })
        expect(reminders(pi)).toHaveLength(2)
        expect(reminders(pi)[0]?.["display"]).toBe(false)
      })
    })

    describe("#when the prompt was queued while the agent was streaming", () => {
      it("#then the reminder still rides as a hidden message and the typed text is never rewritten", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })

        const steer = await sendQueuedInput(pi, "steer")
        const followUp = await sendQueuedInput(pi, "followUp")

        // Never transform: an appended reminder renders inside the user's own bubble in the TUI.
        // senpi steers a mid-stream custom message into the RUNNING turn (agent.steer), so a hidden
        // message costs no extra assistant turn on this path either.
        expect(steer).toEqual({ action: "continue" })
        expect(followUp).toEqual({ action: "continue" })
        const injected = reminders(pi)
        expect(injected).toHaveLength(2)
        for (const message of injected) {
          expect(message["display"]).toBe(false)
        }
      })
    })

    describe("#when a refusal fallback follows an aborted message carrying stale refusal details", () => {
      it("#then nothing is injected", async () => {
        const pi = await setup()
        await endMessage(pi, { role: "assistant", stopReason: "aborted", stopDetails: { type: "refusal" } })
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        expect(pi.messages).toHaveLength(0)
      })
    })

    describe("#when the input came from an extension rather than the user", () => {
      it("#then no reminder is injected", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        await sendInput(pi, "extension")
        expect(reminders(pi)).toHaveLength(0)
      })
    })

    describe("#when the chain falls back a second time from the weaker model", () => {
      it("#then no second directive is injected and the state stays active", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        await endMessage(pi, { role: "assistant", stopReason: "error", errorMessage: "Request timed out." })
        await selectModel(pi, { model: KIMI, previousModel: OPUS, source: "fallback" })

        expect(directives(pi)).toHaveLength(1)
        await sendInput(pi)
        expect(reminders(pi)).toHaveLength(1)
      })
    })

    describe("#when fable 5 becomes the active model again", () => {
      it("#then the reminder stops", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        await selectModel(pi, { model: FABLE, previousModel: OPUS, source: "set" })
        await sendInput(pi)
        expect(reminders(pi)).toHaveLength(0)
      })
    })

    describe("#when the fallback is reverted by senpi", () => {
      it("#then the reminder stops", async () => {
        const pi = await setup()
        await endMessage(pi, refusalMessage())
        await selectModel(pi, { model: OPUS, previousModel: FABLE, source: "fallback" })
        await selectModel(pi, { model: FABLE, previousModel: OPUS, source: "fallback-revert" })
        await sendInput(pi)
        expect(reminders(pi)).toHaveLength(0)
      })
    })
  })

  describe("#given malformed host payloads", () => {
    describe("#when they reach the handlers", () => {
      it("#then the component ignores them without throwing", async () => {
        const pi = await setup()
        await pi.dispatch("message_end", undefined, undefined)
        await pi.dispatch("model_select", { type: "model_select" }, undefined)
        await pi.dispatch("model_select", null, undefined)
        const result = await pi.dispatch("input", { type: "input" }, undefined)
        expect(pi.messages).toHaveLength(0)
        expect(result[0]).toEqual({ action: "continue" })
      })
    })
  })
})
