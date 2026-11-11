import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "../context"
import { registerKibitzerHooks, type KibitzerHooksOptions } from "./hooks"

const identity = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-kibitzer-13074", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})

const host = { sessionManager: { getSessionId: () => "session-13074", getBranch: () => [], getEntries: () => [] } }
const readResult = { toolName: "read", toolCallId: "call-1", content: [{ type: "text", text: "data" }] }

function hookOptions(onToolResult: KibitzerHooksOptions["delivery"]["onToolResult"], warnings: string[]): KibitzerHooksOptions {
  return {
    env: {},
    sink: { onPrompt: () => {}, onToolCall: () => {}, onToolResult: () => {}, onSettled: () => {} },
    delivery: {
      onToolResult,
      markRunning: () => {},
      markSettled: () => {},
      markToolStarted: () => {},
      markToolFinished: () => {},
      markTurnEnded: () => {},
    },
    resolveContext: () => identity,
    resolveSessionId: () => "session-13074",
    logger: { warn: (message: string) => { warnings.push(message) }, info: () => {}, error: () => {}, debug: () => {} },
  }
}

describe("Kibitzer tool_result delivery never holds the PostToolUse hook (#13074)", () => {
  test("#given a recall delivery that never settles #when a native read's tool_result dispatches #then the hook returns and the delivery was started", async () => {
    // given
    const pi = new FakeExtensionAPI()
    let started = 0
    registerKibitzerHooks(pi, hookOptions(() => { started++; return new Promise<void>(() => {}) }, []))

    // when
    const outcome = await Promise.race([
      pi.dispatch("tool_result", readResult, host).then(() => "returned"),
      new Promise<string>((resolve) => setImmediate(() => setImmediate(() => resolve("blocked")))),
    ])

    // then
    expect(outcome).toBe("returned")
    expect(started).toBe(1)
  })

  test("#given a recall delivery that rejects after the hook returned #when it fails #then the failure is logged, not thrown", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: string[] = []
    let fail: (error: Error) => void = () => {}
    const failed = new Promise<void>((_resolve, reject) => { fail = reject })
    registerKibitzerHooks(pi, hookOptions(() => failed, warnings))

    // when
    const results = await pi.dispatch("tool_result", readResult, host)
    fail(new Error("steer refused"))
    await failed.catch(() => {})
    await Promise.resolve()

    // then
    expect(results).toEqual([undefined])
    expect(warnings).toEqual(["omo-senpi kibitzer tool_result delivery failed"])
  })
})
