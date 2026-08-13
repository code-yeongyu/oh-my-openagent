import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
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
  sessionScopeRunner,
  withEnvAsync,
} from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop session scoping (issue #6828)", () => {
  it("#given session A owns an active run in the shared cwd #when session B's agent_end fires #then B receives no continuation", async () => {
    // given a scope-aware runner: unscoped calls (the pre-fix fallback) see A's root run,
    // calls scoped to senpi-A see A's run, calls scoped to any other session see nothing
    const runner = sessionScopeRunner({ "senpi-A": activeStatus("G-A") })
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    // when B (an independent session in the same cwd) finishes an unrelated task
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "B" }))

    // then no continuation is injected into B
    expect(pi.messages).toEqual([])
  })

  it("#given session A owns an active run #when session B submits a queued prompt #then B's text is not contaminated with a steering reminder", async () => {
    const runner = sessionScopeRunner({ "senpi-A": activeStatus("G-A") })
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue my work", source: "interactive", streamingBehavior: "steer" },
      sessionEventCtx("/repo", { sessionId: "B" }),
    )

    expect(results).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
  })

  it("#given session A owns an active run #when A's own agent_end fires #then exactly one continuation is delivered", async () => {
    const runner = sessionScopeRunner({ "senpi-A": activeStatus("G-A") })
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(pi.messages).toEqual([
      {
        message: {
          customType: "omo-senpi:ulw-continuation",
          content: expect.stringContaining("Continue the active omo-agent-toolkit ulw-loop run"),
          display: false,
        },
        options: { triggerTurn: true, deliverAs: "followUp" },
      },
    ])
  })

  it("#given session A owns an active run #when A submits a queued prompt #then the steering reminder is injected", async () => {
    const runner = sessionScopeRunner({ "senpi-A": activeStatus("G-A") })
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
      sessionEventCtx("/repo", { sessionId: "A" }),
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ action: "transform" })
    const transformed = results[0]
    if (!isTransformResult(transformed)) throw new Error("expected transform result")
    expect(transformed.text).toContain("<omo-senpi-ulw-loop>")
  })

  it("#given a session #when session_start, queued input, agent_end, and tool_result fire #then every status call is scoped to the session", async () => {
    const runner = sessionScopeRunner({ "senpi-A": activeStatus("G-A") })
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })
    const eventCtx = sessionEventCtx("/repo", { sessionId: "A" })

    await pi.dispatch("session_start", { type: "session_start" }, eventCtx)
    await pi.dispatch(
      "input",
      { type: "input", text: "go on", source: "interactive", streamingBehavior: "steer" },
      eventCtx,
    )
    await pi.dispatch("tool_result", { toolName: "bash" }, eventCtx)
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx)

    const scoped = runner.calls.filter((call) => call.args.includes("--session-id") && call.args[call.args.indexOf("--session-id") + 1] === "senpi-A")
    expect(scoped).toHaveLength(runner.calls.length)
    expect(scoped).toHaveLength(4)
  })

  it("#given an eventCtx without a session id #when agent_end fires #then no CLI call happens and no continuation is delivered", async () => {
    const runner = sessionScopeRunner({})
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(runner.calls).toEqual([])
    expect(pi.messages).toEqual([])
  })

  it("#given an eventCtx without a session id #when a queued prompt arrives #then no CLI call happens and no steering reminder is injected", async () => {
    const runner = sessionScopeRunner({})
    const pi = new FakeExtensionAPI()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: runner.run,
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "hello", source: "interactive", streamingBehavior: "steer" },
      { cwd: "/repo" },
    )

    expect(runner.calls).toEqual([])
    expect(results).toEqual([{ action: "continue" }])
  })

  it("#given a session starts #when session_start fires #then OMO_ULW_LOOP_SESSION_ID is set to the session scope", async () => {
    await withEnvAsync({ OMO_ULW_LOOP_SESSION_ID: undefined }, async () => {
      const { pi } = await registerWithRunner([])

      await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { sessionId: "A" }))

      expect(process.env.OMO_ULW_LOOP_SESSION_ID).toBe("senpi-A")
    })
  })

  it("#given an external OMO_ULW_LOOP_SESSION_ID #when a session activates and then shuts down #then the external value is restored", async () => {
    await withEnvAsync({ OMO_ULW_LOOP_SESSION_ID: "external-codex-thread" }, async () => {
      const { pi } = await registerWithRunner([])

      await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { sessionId: "A" }))
      expect(process.env.OMO_ULW_LOOP_SESSION_ID).toBe("senpi-A")

      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventCtx("/repo", { sessionId: "A" }))

      expect(process.env.OMO_ULW_LOOP_SESSION_ID).toBe("external-codex-thread")
    })
  })

  it("#given a session activates #when the env is externally replaced #then shutdown leaves the external value alone", async () => {
    await withEnvAsync({ OMO_ULW_LOOP_SESSION_ID: undefined }, async () => {
      const { pi } = await registerWithRunner([])

      await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { sessionId: "A" }))
      expect(process.env.OMO_ULW_LOOP_SESSION_ID).toBe("senpi-A")

      process.env.OMO_ULW_LOOP_SESSION_ID = "senpi-B"
      await pi.dispatch("session_before_switch", { type: "session_before_switch" }, sessionEventCtx("/repo", { sessionId: "A" }))
      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventCtx("/repo", { sessionId: "B" }))

      expect(process.env.OMO_ULW_LOOP_SESSION_ID).toBe("senpi-B")
    })
  })
})

describe("omo-senpi ulw-loop continuation", () => {
  it("#given no omo binary #when input and agent_end fire #then the component stays inert for the session", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    await createUlwLoopComponent({ resolveOmoBin: () => null }).register(pi, {
      logger,
      config: { getFlag: () => false },
    })
    const inputResults = await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(inputResults).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "omo-senpi ulw-loop inactive; omo binary not found",
      },
    ])
  })

  it("#given active incomplete ulw-loop status #when queued user input arrives #then steering reminder is injected", async () => {
    const { pi, calls } = await registerWithRunner([activeStatus()])

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
      sessionEventCtx("/repo", { sessionId: "A" }),
    )

    expect(calls).toEqual([{ bin: "/tmp/omo", args: ["ulw-loop", "status", "--json", "--session-id", "senpi-A"], cwd: "/repo" }])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ action: "transform" })
    const transformed = results[0]
    if (!isTransformResult(transformed)) throw new Error("expected transform result")
    expect(transformed.text).toContain("continue")
    expect(transformed.text).toContain("<omo-senpi-ulw-loop>")
    expect(transformed.text).toContain("omo-agent-toolkit ulw-loop status --json")
  })

  it("#given active incomplete ulw-loop status #when idle user input arrives #then typed text is unchanged", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive" },
      sessionEventCtx("/repo", { sessionId: "A" }),
    )

    expect(results).toEqual([{ action: "continue" }])
  })

  it("#given incomplete goals #when continuation agent_end fires #then sends exactly one hidden followUp", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(pi.userMessages).toEqual([])
    expect(pi.messages).toEqual([
      {
        message: {
          customType: "omo-senpi:ulw-continuation",
          content: expect.stringContaining("Continue the active omo-agent-toolkit ulw-loop run"),
          display: false,
        },
        options: { triggerTurn: true, deliverAs: "followUp" },
      },
    ])
  })

  it("#given incomplete goals #when continuation repeats #then cap stops the 9th consecutive continuation", async () => {
    const { pi, logger } = await registerWithRunner(changingActiveStatuses(9))

    for (let index = 0; index < 9; index += 1) {
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))
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
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))
    }
    await pi.dispatch("input", { type: "input", text: "still working", source: "interactive" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(pi.messages).toHaveLength(9)
  })

  it("#given stale status snapshot #when user input arrives #then the next identical active status can continue", async () => {
    const status = activeStatus("G001")
    const { pi, calls } = await registerWithRunner([status, status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("input", { type: "input", text: "resume after user input", source: "interactive" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(calls).toHaveLength(2)
    expect(pi.messages).toHaveLength(2)
    expect(pi.messages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
  })

  it("#given byte-identical status twice #when continuation repeats #then stale status stops continuation", async () => {
    const status = activeStatus("G001")
    const { pi, logger } = await registerWithRunner([status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

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
      sessionEventCtx("/repo", { sessionId: "A" }),
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
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))
    }
    await pi.dispatch("input", { type: "input", text: "ulw-loop", source: "extension" }, sessionEventCtx("/repo", { sessionId: "A" }))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(calls).toHaveLength(8)
    expect(pi.messages).toHaveLength(8)
  })

  it("#given status reports all complete #when continuation fires #then no followUp is sent", async () => {
    const { pi } = await registerWithRunner([completeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { sessionId: "A" }))

    expect(pi.userMessages).toEqual([])
  })

  it("#given goal active before ulw-loop #when a shell tool result activates the run #then the footer starts immediately", async () => {
    for (const toolName of ["bash", "interactive_bash"]) {
      const pi = new FakeExtensionAPI()
      const outputs = [completeStatus(), activeStatus()]
      const calls: Array<{ bin: string; args: readonly string[]; cwd: string }> = []
      const footerCalls: Array<{ key: string; text: string | undefined }> = []
      await createUlwLoopComponent({
        resolveOmoBin: () => "/tmp/omo",
        runCommand: async (bin, args, options) => {
          calls.push({ bin, args, cwd: options.cwd })
          return { code: 0, stdout: outputs.shift() ?? activeStatus() }
        },
        footerStatus: {
          isGoalActive: () => true,
          timers: {
            set: () => 1,
            clear: () => undefined,
          },
        },
      }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })
      const eventCtx = {
        cwd: "/repo",
        sessionManager: {
          getSessionId: () => "A",
        },
        ui: {
          setStatus(key: string, text: string | undefined) {
            footerCalls.push({ key, text })
          },
        },
      }

      await pi.dispatch("session_start", { type: "session_start" }, eventCtx)
      await pi.dispatch("tool_result", { toolName: "read" }, eventCtx)
      await pi.dispatch("tool_result", { toolName }, eventCtx)

      expect(calls).toEqual([
        { bin: "/tmp/omo", args: ["ulw-loop", "status", "--json", "--session-id", "senpi-A"], cwd: "/repo" },
        { bin: "/tmp/omo", args: ["ulw-loop", "status", "--json", "--session-id", "senpi-A"], cwd: "/repo" },
      ])
      expect(footerCalls).toEqual([{ key: "ulw-loop", text: ULW_LOOP_FOOTER_FRAMES[0] }])
    }
  })
})
