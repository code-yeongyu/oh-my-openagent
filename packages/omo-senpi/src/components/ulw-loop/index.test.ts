import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { ULW_LOOP_FOOTER_FRAMES } from "./footer-status"
import { createUlwLoopComponent } from "./index"
import { toSpawnTarget } from "./omo-command"
import {
  activeStatus,
  changingActiveStatuses,
  completeStatus,
  createLogger,
  isTransformResult,
  registerWithRunner,
  sessionEventCtx,
  statusArgsFor,
} from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop continuation session isolation", () => {
  it("#given Windows staged toolkit #when resolving its spawn target #then uses cmd.exe with the .cmd wrapper", () => {
    const bin = stagedToolkitBin("win32")

    expect(bin).toEndWith("omo-agent-toolkit.cmd")
    expect(toSpawnTarget(bin, ["ulw-loop", "status", "--json"], "win32")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", bin, "ulw-loop", "status", "--json"],
    })
  })

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
  it("#given no omo binary #when input and agent_end fire #then the component stays inert for the session", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    await createUlwLoopComponent({ resolveOmoBin: () => null }).register(pi, {
      logger,
      config: { getFlag: () => false },
    })
    const inputResults = await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, sessionEventCtx("/repo"))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

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
      sessionEventCtx("/repo"),
    )

    expect(calls).toEqual([{ bin: "/tmp/omo", args: statusArgsFor(), cwd: "/repo" }])
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
      sessionEventCtx("/repo"),
    )

    expect(results).toEqual([{ action: "continue" }])
  })

  it("#given incomplete goals #when continuation agent_end fires #then sends exactly one hidden followUp", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

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
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))
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
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))
    }
    await pi.dispatch("input", { type: "input", text: "still working", source: "interactive" }, sessionEventCtx("/repo"))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

    expect(pi.messages).toHaveLength(9)
  })

  it("#given stale status snapshot #when user input arrives #then the next identical active status can continue", async () => {
    const status = activeStatus("G001")
    const { pi, calls } = await registerWithRunner([status, status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))
    await pi.dispatch("input", { type: "input", text: "resume after user input", source: "interactive" }, sessionEventCtx("/repo"))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

    expect(calls).toHaveLength(2)
    expect(pi.messages).toHaveLength(2)
    expect(pi.messages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
  })

  it("#given byte-identical status twice #when continuation repeats #then stale status stops continuation", async () => {
    const status = activeStatus("G001")
    const { pi, logger } = await registerWithRunner([status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

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
      await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))
    }
    await pi.dispatch("input", { type: "input", text: "ulw-loop", source: "extension" }, sessionEventCtx("/repo"))
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

    expect(calls).toHaveLength(8)
    expect(pi.messages).toHaveLength(8)
  })

  it("#given status reports all complete #when continuation fires #then no followUp is sent", async () => {
    const { pi } = await registerWithRunner([completeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))

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
        { bin: "/tmp/omo", args: statusArgsFor(), cwd: "/repo" },
        { bin: "/tmp/omo", args: statusArgsFor(), cwd: "/repo" },
      ])
      expect(footerCalls).toEqual([{ key: "ulw-loop", text: ULW_LOOP_FOOTER_FRAMES[0] }])
    }
  })
})

function stagedToolkitBin(platform: NodeJS.Platform = process.platform): string {
  const executable = platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit"
  return join(import.meta.dir, "../../../plugin/runtime/agent-toolkit", executable)
}
