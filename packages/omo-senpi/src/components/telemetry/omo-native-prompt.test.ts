/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createOmoNativePromptComponent } from "./omo-native-prompt"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"
import { createSilentLogger } from "./telemetry.test-support"
import { createSessionArming, createUltraworkComponent, type SessionArming } from "../ultrawork/index"
import { SENPI_ULTRAWORK_DIRECTIVE } from "../ultrawork/generated-directive"

type CapturedPrompt = { readonly name: string; readonly properties: EventTelemetryProperties }
type Source = "interactive" | "rpc" | "extension"
type StreamingBehavior = "steer" | "followUp"

const ARMING_LEDGER_KEY = Symbol.for("omo.ultrawork.arming")
const context: ComponentContext = {
  logger: createSilentLogger(),
  config: { getFlag: () => undefined },
}

function sessionCtx(sessionId: string): { sessionManager: { getSessionId(): string } } {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function seedArming(arming: SessionArming): () => void {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const previous = registry[ARMING_LEDGER_KEY]
  registry[ARMING_LEDGER_KEY] = { directive: SENPI_ULTRAWORK_DIRECTIVE, arming }
  return () => {
    if (previous === undefined) delete registry[ARMING_LEDGER_KEY]
    else registry[ARMING_LEDGER_KEY] = previous
  }
}

async function harness(options: { withUltrawork?: boolean } = {}) {
  const pi = new FakeExtensionAPI()
  const captures: CapturedPrompt[] = []
  const arming = createSessionArming()
  const restore = seedArming(arming)
  await createOmoNativePromptComponent({
    client: { captureEvent: (name, properties) => captures.push({ name, properties }) },
    hashSessionId: (sessionId) => `hash:${sessionId}`,
  }).register(pi, context)
  if (options.withUltrawork === true) await createUltraworkComponent(arming).register(pi, context)
  return { pi, captures, arming, restore }
}

async function input(
  pi: FakeExtensionAPI,
  inputId: string,
  text: string,
  sessionId: string,
  source: Source = "interactive",
  streamingBehavior?: StreamingBehavior,
): Promise<void> {
  await pi.dispatch("input", {
    type: "input",
    inputId,
    text,
    source,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
  }, sessionCtx(sessionId))
}

async function disposition(pi: FakeExtensionAPI, inputId: string, value: "queued" | "started" | "handled" | "rejected"): Promise<void> {
  await pi.dispatch("input_disposition", { type: "input_disposition", inputId, disposition: value })
}

describe("OmO Native prompt telemetry", () => {
  test("#given canonical ultrawork prompts #when dispositions arrive #then pre-mutation classifications and buckets are emitted", async () => {
    const testHarness = await harness({ withUltrawork: true })
    try {
      await input(testHarness.pi, "first", "ulw ulw ulw plan", "session-a")
      await disposition(testHarness.pi, "first", "started")
      await input(testHarness.pi, "second", "ulw continue", "session-a")
      await disposition(testHarness.pi, "second", "started")
      await testHarness.pi.dispatch("session_compact", { type: "session_compact", accepted: true }, sessionCtx("session-a"))
      await input(testHarness.pi, "third", "ulw after compact", "session-a")
      await disposition(testHarness.pi, "third", "started")

      expect(testHarness.captures.map(({ properties }) => ({
        bucket: properties["keyword_occurrence_bucket"],
        effective: properties["is_effective_ultrawork_invocation"],
        stage: properties["invocation_stage"],
        variant: properties["keyword_variant"],
      }))).toEqual([
        { bucket: "3_5", effective: true, stage: "first_arm", variant: "ulw" },
        { bucket: "1", effective: true, stage: "remention", variant: "ulw" },
        { bucket: "1", effective: true, stage: "post_compact_rearm", variant: "ulw" },
      ])
    } finally {
      testHarness.restore()
    }
  })

  test("#given suppression and source cases #when submitted #then skill names do not match and extension prompts stay non-real", async () => {
    const testHarness = await harness()
    try {
      await input(testHarness.pi, "skill", "ulw-plan", "session-a")
      await disposition(testHarness.pi, "skill", "started")
      await input(testHarness.pi, "extension", "ultrawork internal", "session-a", "extension")
      await disposition(testHarness.pi, "extension", "handled")

      expect(testHarness.captures.map(({ properties }) => ({
        any: properties["keyword_any"],
        real: properties["is_real_user_prompt"],
        stage: properties["invocation_stage"],
        suppression: properties["suppression_reason"],
      }))).toEqual([
        { any: false, real: true, stage: "none", suppression: "no_keyword" },
        { any: true, real: false, stage: "none", suppression: "extension_source" },
      ])
    } finally {
      testHarness.restore()
    }
  })

  test("#given queued steering and duplicate dispositions #when handled #then queue semantics emit exactly once", async () => {
    const testHarness = await harness()
    try {
      await input(testHarness.pi, "queued", "please continue", "session-a", "interactive", "steer")
      await disposition(testHarness.pi, "queued", "queued")
      await disposition(testHarness.pi, "queued", "started")
      await disposition(testHarness.pi, "unknown", "rejected")

      expect(testHarness.captures).toHaveLength(1)
      expect(testHarness.captures[0]?.properties).toMatchObject({ is_turn_start: false, queue_mode: "steer" })
    } finally {
      testHarness.restore()
    }
  })

  test("#given telemetry snapshots before the mutating handler #when arming changes before disposition #then first arm is preserved", async () => {
    const testHarness = await harness()
    try {
      await input(testHarness.pi, "ordered", "ulw ship it", "session-order")
      testHarness.arming.markArmed("session-order")
      await disposition(testHarness.pi, "ordered", "started")

      expect(testHarness.captures[0]?.properties["invocation_stage"]).toBe("first_arm")
    } finally {
      testHarness.restore()
    }
  })

  test("#given every disposition and prompt size boundary #when emitted #then queue, length, and ordinal buckets are stable per session", async () => {
    const testHarness = await harness()
    try {
      const rows = [
        ["a1", "a", "session-a", "started", undefined],
        ["a2", "x".repeat(100), "session-a", "queued", "followUp"],
        ["a3", "x".repeat(500), "session-a", "handled", undefined],
        ["a4", "x".repeat(2_000), "session-a", "rejected", undefined],
        ["b1", "b", "session-b", "started", undefined],
      ] as const
      for (const [inputId, text, sessionId, value, streamingBehavior] of rows) {
        await input(testHarness.pi, inputId, text, sessionId, "interactive", streamingBehavior)
        await disposition(testHarness.pi, inputId, value)
      }

      expect(testHarness.captures.map(({ properties }) => [
        properties["queue_mode"], properties["prompt_length_bucket"], properties["real_prompt_ordinal_bucket"],
      ])).toEqual([
        ["immediate", "lt_100", "1"],
        ["follow_up", "100_500", "2_3"],
        ["other", "500_2000", "2_3"],
        ["other", "gte_2000", "4_10"],
        ["immediate", "lt_100", "1"],
      ])
    } finally {
      testHarness.restore()
    }
  })

  test("#given pending input at shutdown #when shutdown flushes then a late disposition arrives #then one other-mode event remains", async () => {
    const testHarness = await harness()
    try {
      await input(testHarness.pi, "cancelled", "ulw resume later", "session-a")
      await testHarness.pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionCtx("session-a"))
      await disposition(testHarness.pi, "cancelled", "started")

      expect(testHarness.captures).toHaveLength(1)
      expect(testHarness.captures[0]?.properties).toMatchObject({ queue_mode: "other", is_turn_start: false })
    } finally {
      testHarness.restore()
    }
  })

  test("#given malformed and adversarial inputs #when dispatched #then valid text emits without retaining text and missing ids are ignored", async () => {
    const testHarness = await harness()
    try {
      const texts = ["", "x".repeat(100_000), "[](){}.*+?^$|\\", "안녕하세요 ulw 부탁해"]
      for (const [index, text] of texts.entries()) {
        await input(testHarness.pi, `edge-${index}`, text, "session-edge")
        await disposition(testHarness.pi, `edge-${index}`, "started")
      }
      await expect(testHarness.pi.dispatch("input", { type: "input", text: "ulw", source: "interactive" }, sessionCtx("session-edge"))).resolves.toBeDefined()
      await disposition(testHarness.pi, "missing", "started")

      expect(testHarness.captures).toHaveLength(4)
      for (const capture of testHarness.captures) {
        expect(Object.keys(capture.properties).sort()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.prompt_submitted].sort())
        expect(JSON.stringify(capture.properties)).not.toContain("100000")
        expect(capture.properties).not.toHaveProperty("text")
      }
    } finally {
      testHarness.restore()
    }
  })
})
