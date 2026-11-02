import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

import { dispatchRunEnd, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { ULW_LOOP_FOOTER_FRAMES } from "./footer-status"
import { createUlwLoopComponent } from "./index"
import {
  activeStatus,
  changingActiveStatuses,
  completeStatus,
  createLogger,
  isTransformResult,
  registerWithRunner,
  sessionEventCtx,
  TEST_SESSION_ID,
} from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop continuation session isolation", () => {
  it("#given two independent sessions share one cwd #when the child-process probe runs #then only the owner continues", () => {
    const output = execFileSync(
      process.execPath,
      [join(import.meta.dir, "../../../scripts/qa/probe-cross-session.mjs")],
      {
        encoding: "utf8",
        timeout: 60_000,
      },
    )

    expect(JSON.parse(output)).toMatchObject({
      verdict: "PASS",
      sessionA: { messageCount: 1 },
      sessionB: { messageCount: 0 },
      paths: {
        ownerPlan: true,
        unrelatedPlan: false,
        sharedRootPlan: false,
      },
      cleanup: { removedSharedCwd: true },
    })
  })
})

describe("omo-senpi ulw-loop continuation", () => {
  it("#given no toolkit CLI on this host #when input and agent_end fire #then the component still runs and never reports itself inactive", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    await createUlwLoopComponent().register(pi, {
      logger,
      config: { getFlag: () => false },
    })
    const inputResults = await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    // No plan exists under /repo, so the hook stays out of the way without any CLI probe.
    expect(inputResults).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
    expect(logger.entries.map((entry) => entry.message)).not.toContain("omo-senpi ulw-loop inactive; omo binary not found")
    expect(pi.tools.map((tool) => tool.name)).not.toContain("omo_agent_toolkit")
    expect(pi.removedToolHints.get("omo_agent_toolkit")).toMatch(/OMO_AGENT_TOOLKIT_SDK_ROOT/)
  })

  it("#given active incomplete ulw-loop status #when queued user input arrives #then steering reminder is injected", async () => {
    const { pi, calls } = await registerWithRunner([activeStatus()])

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
      sessionEventCtx("/repo"),
    )

    expect(calls).toEqual([{ cwd: "/repo", sessionId: TEST_SESSION_ID }])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ action: "transform" })
    const transformed = results[0]
    if (!isTransformResult(transformed)) throw new Error("expected transform result")
    expect(transformed.text).toContain("continue")
    expect(transformed.text).toContain("<omo-senpi-ulw-loop>")
    expect(transformed.text).toContain('await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)')
    expect(transformed.text).toContain("agentToolkit.status()")
    expect(transformed.text).not.toMatch(/tool\.omo_agent_toolkit/)
  })

  it("#given active incomplete ulw-loop status #when idle user input arrives #then typed text is unchanged", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive" },
      sessionEventCtx("/repo"),
    )

    expect(results).toEqual([{ action: "continue" }])
  })

  it("#given incomplete goals #when continuation agent_end fires #then sends exactly one hidden followUp", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(pi.userMessages).toEqual([])
    expect(pi.messages).toEqual([
      {
        message: {
          customType: "omo-senpi:ulw-continuation",
          content: expect.stringContaining("Continue the active ulw-loop run"),
          display: false,
        },
        options: { triggerTurn: true, deliverAs: "followUp" },
      },
    ])
    const continuation = pi.messages[0]?.message["content"]
    if (typeof continuation !== "string") throw new Error("expected a string continuation prompt")
    expect(continuation).toContain('await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)')
    expect(continuation).not.toMatch(/tool\.omo_agent_toolkit/)
  })

  it("#given incomplete goals #when continuation repeats #then cap stops the 9th consecutive continuation", async () => {
    const { pi, logger } = await registerWithRunner(changingActiveStatuses(9))

    for (let index = 0; index < 9; index += 1) {
      await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))
    }

    expect(pi.messages).toHaveLength(8)
    expect(pi.messages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: { reason: "continuation-cap-reached", count: 8 },
    })
  })

  it("#given continuation cap was reached #when user input resets it #then continuation can resume", async () => {
    const { pi } = await registerWithRunner(changingActiveStatuses(10))

    for (let index = 0; index < 8; index += 1) {
      await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))
    }
    await pi.dispatch("input", { type: "input", text: "still working", source: "interactive" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(pi.messages).toHaveLength(9)
  })

  it("#given stale status snapshot #when user input arrives #then the next identical active status can continue", async () => {
    const status = activeStatus("G001")
    const { pi, calls } = await registerWithRunner([status, status, status])

    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))
    await pi.dispatch("input", { type: "input", text: "resume after user input", source: "interactive" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(calls).toHaveLength(2)
    expect(pi.messages).toHaveLength(2)
    expect(pi.messages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
  })

  it("#given byte-identical status twice #when continuation repeats #then stale status stops continuation", async () => {
    const status = activeStatus("G001")
    const { pi, logger } = await registerWithRunner([status, status])

    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(pi.messages).toHaveLength(1)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: { reason: "stale-status" },
    })
  })

  it("#given malformed JSON #when input checks status #then it degrades to no-op with a warning", async () => {
    const { pi, logger } = await registerWithRunner(["{bad json"])

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "hello", source: "interactive", streamingBehavior: "steer" },
      sessionEventCtx("/repo"),
    )

    expect(results).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "omo-senpi ulw-loop status ignored",
      details: { reason: "malformed-json" },
    })
  })

  it("#given extension input #when it contains text #then it does not reset or inject", async () => {
    const { pi, calls } = await registerWithRunner(changingActiveStatuses(9))

    for (let index = 0; index < 8; index += 1) {
      await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))
    }
    await pi.dispatch("input", { type: "input", text: "ulw-loop", source: "extension" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(calls).toHaveLength(8)
    expect(pi.messages).toHaveLength(8)
  })

  it("#given status reports all complete #when continuation fires #then no followUp is sent", async () => {
    const { pi } = await registerWithRunner([completeStatus()])

    await dispatchRunEnd(pi, { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, sessionEventCtx("/repo"))

    expect(pi.userMessages).toEqual([])
  })

  it("#given goal active before ulw-loop #when a shell tool result activates the run #then the footer starts immediately", async () => {
    for (const toolName of ["bash", "interactive_bash", "eval"]) {
      const pi = new FakeExtensionAPI()
      const outputs = [completeStatus(), activeStatus()]
      const calls: Array<{ cwd: string; sessionId: string }> = []
      const footerCalls: Array<{ key: string; text: string | undefined }> = []
      await createUlwLoopComponent({
        readStatus: async (cwd, sessionId) => {
          calls.push({ cwd, sessionId })
          return { code: 0, stdout: outputs.shift() ?? activeStatus() }
        },
        planExists: () => true,
        footerStatus: {
          isGoalActive: () => true,
          timers: {
            set: () => 1,
            clear: () => undefined,
          },
        },
      }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })
      const eventCtx = sessionEventCtx("/repo", {
        ui: {
          setStatus(key: string, text: string | undefined) {
            footerCalls.push({ key, text })
          },
        },
      })

      await pi.dispatch("session_start", { type: "session_start" }, eventCtx)
      await pi.dispatch("tool_result", { toolName: "read" }, eventCtx)
      await pi.dispatch("tool_result", { toolName }, eventCtx)

      expect(calls).toEqual([
        { cwd: "/repo", sessionId: TEST_SESSION_ID },
        { cwd: "/repo", sessionId: TEST_SESSION_ID },
      ])
      expect(footerCalls).toEqual([{ key: "ulw-loop", text: ULW_LOOP_FOOTER_FRAMES[0] }])
    }
  })
})
