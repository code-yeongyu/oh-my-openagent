import { describe, expect, test } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { StartupWork } from "../../extension/startup-deferral"
import { createDeviceServiceComponent, type DeviceServiceComponentOptions } from "./index"

// #12379: every tui or rpc engine process, except task children and
// `device_service.enabled: false`, starts one agent-dir registrant for the agent dir the engine itself resolved, in the
// extension's process scope so no session's teardown can close it. PR 12257's TUI bootstrap gates (absolute OMO_BIN,
// a UI) do not apply to it.

const AGENT_DIR = "/home/user/.omo/agent-desktop"

type Started = { readonly agentDir: string; readonly sessionStore: unknown }

// Stands in for senpi's per-session handle owner: senpi enters an AsyncLocalStorage store around every call into
// extension code and closes what was created inside it when that session ends.
const sessionOwner = new AsyncLocalStorage<string>()

function harness(
  options: Partial<DeviceServiceComponentOptions> & { readonly mode?: string; readonly hasUI?: boolean } = {},
) {
  const pi = new FakeExtensionAPI()
  const deferred: StartupWork[] = []
  const started: Started[] = []
  const ctx: ComponentContext = {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: () => undefined },
    deferStartupWork: (_label, work) => deferred.push(work),
  }
  const eventCtx = {
    cwd: "/work/project",
    agentDir: AGENT_DIR,
    hasUI: options.hasUI ?? false,
    mode: options.mode ?? "rpc",
    ui: { notify() {} },
  }
  const component = createDeviceServiceComponent({
    env: {},
    latch: { claimed: true },
    registrantLatch: { claimed: false },
    loadConfig: () => ({ config: {} }),
    startRegistrant: ({ agentDir }) => {
      started.push({ agentDir, sessionStore: sessionOwner.getStore() })
    },
    ...options,
  })
  component.register(pi, ctx)
  const start = (session = "session-1") =>
    sessionOwner.run(session, () => {
      for (const { event, handler } of pi.handlers)
        if (event === "session_start") handler({ reason: "startup" }, eventCtx)
    })
  const flush = async (session = "session-1") => {
    for (const work of deferred.splice(0)) await sessionOwner.run(session, () => work())
  }
  return { started, start, flush }
}

describe("device-service agent dir registrant start (#12379)", () => {
  test.each(["tui", "rpc"])(
    "a %s engine starts one registrant for its own resolved agent dir, with no OMO_BIN and no UI",
    async (mode) => {
      const h = harness({ mode })

      h.start()
      await h.flush()

      expect(h.started.map(({ agentDir }) => agentDir)).toEqual([AGENT_DIR])
    },
  )

  test.each(["print", "json"])("a %s run starts no registrant", async (mode) => {
    const h = harness({ mode })

    h.start()
    await h.flush()

    expect(h.started).toEqual([])
  })

  test("a task child (team members included) starts no registrant", async () => {
    const h = harness({ env: { OMO_SENPI_TASK_RPC_CHILD: "1" } })

    h.start()
    await h.flush()

    expect(h.started).toEqual([])
  })

  test("an engine under CI starts no registrant, so a developer's test engines never register with their own service", async () => {
    const h = harness({ env: { CI: "true" } })

    h.start()
    await h.flush()

    expect(h.started).toEqual([])
  })

  test("device_service.enabled: false starts no registrant", async () => {
    const h = harness({ loadConfig: () => ({ config: { device_service: { enabled: false } } }) })

    h.start()
    await h.flush()

    expect(h.started).toEqual([])
  })

  test("a second session, and a reloaded copy of the component, start no second registrant in the process", async () => {
    const registrantLatch = { claimed: false }
    const first = harness({ registrantLatch })
    const reloaded = harness({ registrantLatch })

    first.start("session-1")
    await first.flush("session-1")
    first.start("session-2")
    await first.flush("session-2")
    reloaded.start("session-3")
    await reloaded.flush("session-3")

    expect([...first.started, ...reloaded.started].map(({ agentDir }) => agentDir)).toEqual([AGENT_DIR])
  })

  test("the registrant starts outside the starting session's scope, so that session's teardown cannot close it", async () => {
    const h = harness()

    h.start("session-1")
    await h.flush("session-1")

    expect(h.started).toEqual([{ agentDir: AGENT_DIR, sessionStore: undefined }])
  })
})
