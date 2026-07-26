import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { SENPI_RPC_CHILD_MARKER_ENV, wireSessionStartProcessSweep } from "./process-sweep"

interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
}

function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    warn: (message) => entries.push({ level: "warn", message }),
    error: (message) => entries.push({ level: "error", message }),
  }
}

function ctxFor(logger: ComponentLogger): ComponentContext {
  return {
    logger,
    config: { getFlag: () => undefined },
  }
}

async function flushMicrotasks(): Promise<void> {
  // drain the .then(() => sweep()) hop plus the sweep promise itself
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("wireSessionStartProcessSweep()", () => {
  it("#given a wired sweep #when session_start fires #then the family sweep runs", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    let sweepCalls = 0
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: async () => {
        sweepCalls += 1
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    expect(sweepCalls).toBe(1)
  })

  it("#given the RPC child marker is set #when session_start fires #then the sweep is skipped", async () => {
    // given an env carrying SENPI_CODING_AGENT_SESSION_DIR (senpi-task RPC child)
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    let sweepCalls = 0
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: { [SENPI_RPC_CHILD_MARKER_ENV]: "/tmp/child-session" },
      sweep: async () => {
        sweepCalls += 1
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    expect(sweepCalls).toBe(0)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi process sweep skipped: running inside a senpi-task RPC child",
    })
  })

  it("#given a never-resolving sweep #when session_start fires #then the handler returns without blocking", async () => {
    // given a sweep promise that never settles
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: () => new Promise(() => {}),
    })

    // when the session-start dispatch completes while the sweep is still pending
    const results = await pi.dispatch("session_start", {})

    // then dispatch did not await the sweep
    expect(results).toBeDefined()
  })

  it("#given a failing sweep #when session_start fires #then the failure is logged and cannot propagate", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: async () => {
        throw new Error("boom")
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    const failures = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message === "omo-senpi process sweep failed",
    )
    expect(failures).toHaveLength(1)
  })

  it("#given a synchronously throwing sweep #when session_start fires #then the failure is logged and cannot propagate", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: () => {
        throw new Error("sync boom")
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    const failures = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.startsWith("omo-senpi process sweep failed"),
    )
    expect(failures).toHaveLength(1)
  })
})
