import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createHerdrAgentStateComponent, runCommand, runCommandSync } from "./index"

type CommandCall = {
  readonly args: readonly string[]
  readonly command: string
}

function context(warnings: unknown[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: {
      error() {},
      info() {},
      warn: (_message, details) => warnings.push(details),
    },
  }
}

describe("createHerdrAgentStateComponent", () => {
  test("#given a Herdr pane #when the Senpi lifecycle advances #then it reports idle working idle and releases ownership", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const calls: CommandCall[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: () => () => {},
      runCommand: async (command, args) => {
        calls.push({ command, args })
        return { ok: true, code: 0, stderrBytes: 0 }
      },
      runCommandSync: (command, args) => {
        calls.push({ command, args })
        return { ok: true, code: 0, stderrBytes: 0 }
      },
    }).register(pi, context([]))

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("agent_start", {})
    await pi.dispatch("agent_settled", {})
    await pi.dispatch("session_shutdown", {})

    // then
    expect(calls).toEqual([
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "working"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "release-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo"],
      },
    ])
  })

  test("#given no Herdr environment #when lifecycle events fire #then it performs no commands", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const calls: CommandCall[] = []
    createHerdrAgentStateComponent({
      environment: {},
      runCommand: async (command, args) => {
        calls.push({ command, args })
        return { ok: true, code: 0, stderrBytes: 0 }
      },
    }).register(pi, context([]))

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("agent_start", {})
    await pi.dispatch("agent_settled", {})
    await pi.dispatch("session_shutdown", {})

    // then
    expect(calls).toEqual([])
  })

  test("#given Senpi exits without session_shutdown #when process exit fires #then it releases ownership synchronously", () => {
    // given
    const pi = new FakeExtensionAPI()
    const calls: CommandCall[] = []
    let exitHandler: (() => void) | undefined
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: (handler) => {
        exitHandler = handler
        return () => {
          exitHandler = undefined
        }
      },
      runCommandSync: (command, args) => {
        calls.push({ command, args })
        return { ok: true, code: 0, stderrBytes: 0 }
      },
    }).register(pi, context([]))

    // when
    exitHandler?.()

    // then
    expect(calls).toEqual([
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "release-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo"],
      },
    ])
  })

  test("#given session_shutdown #when it runs #then it unregisters the process-exit handler so exit cannot release twice", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const syncCalls: CommandCall[] = []
    let exitHandler: (() => void) | undefined
    let unregisterCalls = 0
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: (handler) => {
        exitHandler = handler
        return () => {
          unregisterCalls += 1
          exitHandler = undefined
        }
      },
      runCommand: async () => ({ ok: true, code: 0, stderrBytes: 0 }),
      runCommandSync: (command, args) => {
        syncCalls.push({ command, args })
        return { ok: true, code: 0, stderrBytes: 0 }
      },
    }).register(pi, context([]))

    // when
    await pi.dispatch("session_shutdown", {})
    const callsAfterShutdown = syncCalls.length
    exitHandler?.()

    // then
    expect(unregisterCalls).toBe(1)
    expect(callsAfterShutdown).toBe(2)
    expect(syncCalls.length).toBe(2)
  })

  test("#given Herdr rejects a report #when the lifecycle event fires #then the session continues and only bounded metadata is logged", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: () => () => {},
      runCommand: async () => ({ ok: false, code: 2, reason: "nonzero", stderrBytes: 17 }),
    }).register(pi, context(warnings))

    // when
    const results = await pi.dispatch("agent_start", {})

    // then
    expect(results).toEqual([undefined])
    expect(warnings).toEqual([
      {
        action: "report-agent",
        reason: "nonzero",
        code: 2,
        stderrBytes: 17,
      },
    ])
    const [detail] = warnings as Record<string, unknown>[]
    expect("stderr" in detail).toBe(false)
    expect("error" in detail).toBe(false)
  })

  test("#given a report that throws #when the lifecycle event fires #then the session continues and logs the error name only", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: () => () => {},
      runCommand: async () => {
        throw new Error("socket path /home/user/.herdr.sock is unreachable")
      },
    }).register(pi, context(warnings))

    // when
    const results = await pi.dispatch("agent_start", {})

    // then
    expect(results).toEqual([undefined])
    expect(warnings).toEqual([
      {
        action: "report-agent",
        reason: "exception",
        errorName: "Error",
      },
    ])
    const [detail] = warnings as Record<string, unknown>[]
    expect(JSON.stringify(detail)).not.toContain("/home/user")
  })

  test("#given a thrown error with an attacker-controlled name #when it is logged #then the name is bounded to a safe token", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      registerProcessExit: () => () => {},
      runCommand: async () => {
        const error = new Error("ignored")
        error.name = `SECRET=abc\nforged-log-line ${"x".repeat(100)}`
        throw error
      },
    }).register(pi, context(warnings))

    // when
    await pi.dispatch("agent_start", {})

    // then
    expect(warnings).toEqual([
      {
        action: "report-agent",
        reason: "exception",
        errorName: "unknown",
      },
    ])
    expect(JSON.stringify(warnings)).not.toContain("SECRET")
  })
})

describe("runCommand", () => {
  test("#given a child that never exits #when it exceeds the timeout #then it resolves as a bounded timeout failure", async () => {
    // given
    const timeoutMs = 50

    // when
    const outcome = await runCommand(process.execPath, ["-e", "setInterval(function () {}, 1000)"], timeoutMs)

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe("timeout")
    expect(outcome.code).toBeNull()
  })

  test("#given a child that exits nonzero #when it runs #then it resolves as a nonzero failure", async () => {
    // when
    const outcome = await runCommand(process.execPath, ["-e", "process.exit(3)"], 5000)

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe("nonzero")
    expect(outcome.code).toBe(3)
  })
})

describe("runCommandSync", () => {
  test("#given a child that never exits #when it exceeds the timeout #then it returns a bounded timeout failure", () => {
    // when
    const outcome = runCommandSync(process.execPath, ["-e", "setInterval(function () {}, 1000)"], 50)

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe("timeout")
    expect(outcome.code).toBeNull()
  })

  test("#given a child that exits nonzero #when it runs #then it returns a nonzero failure", () => {
    // when
    const outcome = runCommandSync(process.execPath, ["-e", "process.exit(4)"], 5000)

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe("nonzero")
    expect(outcome.code).toBe(4)
  })

  test("#given a child terminated by a signal #when it runs #then it is classified as a signal failure not nonzero", () => {
    // when
    const outcome = runCommandSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"], 5000)

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe("signal")
    expect(outcome.code).toBeNull()
  })
})
