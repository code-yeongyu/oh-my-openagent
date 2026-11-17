import { describe, expect, test } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"
import { resolve } from "node:path"

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

// #13037 cold wake: the device service cold-starts the operator daemon and `omo daemon run` warms it, so omo loads with
// no session_start. The daemon's agent dir must be registered then, or the service has no endpoint and no consumer to
// hand the delivery it started the daemon for. Any other host still waits for a session.
describe("the operator daemon registers its agent dir when it loads omo", () => {
  test.each([
    ["the operator daemon", true],
    ["a desktop thread host", false],
  ])(
    "#given %s loads the component with no session open #when the component registers #then a registrant starts only on the operator daemon",
    async (_what, operatorDaemon) => {
      const daemonSocket = "/tmp/omo-daemon-registrant/rpc/rpc.sock"
      const started: Started[] = []
      const pi = new FakeExtensionAPI()
      pi.cwd = "/work/project"
      Object.assign(pi, {
        sessionContext: {
          host_socket: operatorDaemon ? daemonSocket : "/tmp/omo-daemon-registrant/rpc/i-0123456789abcdef.sock",
          host_instance: "generation-1",
        },
      })
      const loaded = new Promise<void>((resolve) => {
        const component = createDeviceServiceComponent({
          env: { OMO_RPC_SOCKET_PATH: daemonSocket, OMO_CODING_AGENT_DIR: AGENT_DIR },
          latch: { claimed: true },
          registrantLatch: { claimed: false },
          loadConfig: () => ({ config: {} }),
          startRegistrant: ({ agentDir }) => {
            started.push({ agentDir, sessionStore: sessionOwner.getStore() })
            resolve()
          },
        })
        component.register(pi, {
          logger: { info() {}, warn() {}, error() {} },
          config: { getFlag: () => undefined },
          deferStartupWork: () => undefined,
        })
        if (!operatorDaemon) resolve()
      })
      await loaded
      await import("#omo-device-service-runtime")
      // The daemon's own agent dir comes from the launcher variable through resolveAgentHome, which resolves it for the
      // platform (a drive-rooted path on win32).
      expect(started).toEqual(operatorDaemon ? [{ agentDir: resolve(AGENT_DIR), sessionStore: undefined }] : [])
    },
  )
})

// Live cold wake (t2yy, goal1 row 3): the daemon registered its launcher's agent-dir spelling, and the device service,
// scanning <that dir>/rpc-host-daemon, listed no endpoint. The daemon's own environment names its endpoint registry
// (SENPI_RPC_HOST_DAEMON_DIR); the registrant registers that registry's agent dir.
test("#given an operator daemon whose endpoint registry lives under another agent dir than its launcher variable names #when it loads omo #then it registers the agent dir that holds its endpoint registry", async () => {
  const daemonSocket = "/tmp/omo-daemon-registrant-b/rpc/rpc.sock"
  const registryOwner = "/srv/run-root/b/home/.omo/agent"
  const started: Started[] = []
  const pi = new FakeExtensionAPI()
  pi.cwd = "/work/project"
  Object.assign(pi, { sessionContext: { host_socket: daemonSocket, host_instance: "generation-1" } })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the operator daemon's registrant to start")), 5_000)
    createDeviceServiceComponent({
      env: {
        OMO_RPC_SOCKET_PATH: daemonSocket,
        OMO_CODING_AGENT_DIR: "/home/b/.omo/agent",
        SENPI_RPC_HOST_DAEMON_DIR: `${registryOwner}/rpc-host-daemon/0123456789abcdef`,
      },
      latch: { claimed: true },
      registrantLatch: { claimed: false },
      loadConfig: () => ({ config: {} }),
      startRegistrant: ({ agentDir }) => {
        started.push({ agentDir, sessionStore: sessionOwner.getStore() })
        clearTimeout(timer)
        resolve()
      },
    }).register(pi, {
      logger: { info() {}, warn() {}, error() {} },
      config: { getFlag: () => undefined },
      deferStartupWork: () => undefined,
    })
  })
  // the registrant registers the platform-resolved dir (D:\srv\... on Windows), so compare with resolve()
  expect(started.map(({ agentDir }) => agentDir)).toEqual([resolve(registryOwner)])
})

// #13604 (L2): senpi always names an absolute registry dir; a relative one is unreadable, so the registrant falls back
// to the launcher's agent dir instead of registering nothing.
test("#given an operator daemon whose registry dir variable is relative #when it loads omo #then it registers the launcher's agent dir", async () => {
  const daemonSocket = "/tmp/omo-daemon-registrant-c/rpc/rpc.sock"
  const started: Started[] = []
  const warnings: string[] = []
  const pi = new FakeExtensionAPI()
  pi.cwd = "/work/project"
  Object.assign(pi, { sessionContext: { host_socket: daemonSocket, host_instance: "generation-1" } })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the operator daemon's registrant to start")), 5_000)
    createDeviceServiceComponent({
      env: {
        OMO_RPC_SOCKET_PATH: daemonSocket,
        OMO_CODING_AGENT_DIR: AGENT_DIR,
        SENPI_RPC_HOST_DAEMON_DIR: "rpc-host-daemon/0123456789abcdef",
      },
      latch: { claimed: true },
      registrantLatch: { claimed: false },
      loadConfig: () => ({ config: {} }),
      startRegistrant: ({ agentDir }) => {
        started.push({ agentDir, sessionStore: sessionOwner.getStore() })
        clearTimeout(timer)
        resolve()
      },
    }).register(pi, {
      logger: {
        info() {},
        warn: (line: string) => {
          warnings.push(line)
        },
        error() {},
      },
      config: { getFlag: () => undefined },
      deferStartupWork: () => undefined,
    })
  })
  expect(started.map(({ agentDir }) => agentDir)).toEqual([resolve(AGENT_DIR)])
  expect(warnings).toHaveLength(1)
})

// #13609 review L2: a registry path with `..` names the same agent dir as its normalized spelling; the registrant
// registers the normalized one, as resolveAgentHome would, so one dir is never registered under two strings.
test("#given an operator daemon whose registry dir path is not normalized #when it loads omo #then it registers the normalized agent dir", async () => {
  const daemonSocket = "/tmp/omo-daemon-registrant-d/rpc/rpc.sock"
  const started: Started[] = []
  const pi = new FakeExtensionAPI()
  pi.cwd = "/work/project"
  Object.assign(pi, { sessionContext: { host_socket: daemonSocket, host_instance: "generation-1" } })
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the operator daemon's registrant to start")), 5_000)
    createDeviceServiceComponent({
      env: {
        OMO_RPC_SOCKET_PATH: daemonSocket,
        SENPI_RPC_HOST_DAEMON_DIR: "/srv/run-root/a/../b/.omo/agent/rpc-host-daemon/0123456789abcdef",
      },
      latch: { claimed: true },
      registrantLatch: { claimed: false },
      loadConfig: () => ({ config: {} }),
      startRegistrant: ({ agentDir }) => {
        started.push({ agentDir, sessionStore: sessionOwner.getStore() })
        clearTimeout(timer)
        done()
      },
    }).register(pi, {
      logger: { info() {}, warn() {}, error() {} },
      config: { getFlag: () => undefined },
      deferStartupWork: () => undefined,
    })
  })
  expect(started.map(({ agentDir }) => agentDir)).toEqual([resolve("/srv/run-root/b/.omo/agent")])
})
