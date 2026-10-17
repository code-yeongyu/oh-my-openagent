import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { HostUnavailableError, RpcHostRunner, RpcProcessRunner, type EnsureTaskDaemonPort } from "@oh-my-opencode/senpi-task"

import { buildProcessChildRunner, type RunnerBuildContext } from "./engine-runners"
import { createHostExecutionModeGate, createHostNotices } from "./host-execution-mode"
import { TaskRuntimeContext } from "./runtime-context"
import { createSessionShardRouting } from "./shard-routing"

function attachedRuntime(cwd: string, sessionId = "01a0e4ae-parent"): TaskRuntimeContext {
  const runtime = new TaskRuntimeContext(cwd)
  runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
  return runtime
}

function routingFor(input: {
  readonly settings: OmoTaskSettings
  readonly notices: ReturnType<typeof createHostNotices>
  readonly ensureDaemon: EnsureTaskDaemonPort
}) {
  return createSessionShardRouting({
    settings: input.settings,
    runtime: attachedRuntime("/tmp/dh-project"),
    pi: {},
    agentDir: "/tmp/dh-agent",
    env: {},
    notices: input.notices,
    shardEvents: {},
    ensureDaemon: input.ensureDaemon,
    probeHost: () => Promise.resolve(undefined),
  })
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-host-runner-"))
  tempDirs.push(dir)
  return dir
}

function buildContext(settings: OmoTaskSettings, platform: NodeJS.Platform): RunnerBuildContext {
  const cwd = tempProject()
  const notices = createHostNotices(() => {})
  return {
    runtime: new TaskRuntimeContext(cwd),
    sharedParentTools: () => [],
    settings,
    platform,
    agentDir: join(cwd, "agent"),
    env: {},
    hostRouting: {
      ...routingFor({ settings, notices, ensureDaemon: () => Promise.reject(new Error("never ensured here")) }),
      storeDir: join(cwd, ".omo", "senpi-task"),
    },
  }
}

function settingsOf(overrides: Record<string, unknown> = {}): OmoTaskSettings {
  return OmoTaskSettingsSchema.parse(overrides)
}

describe("process child runner selection", () => {
  test("#given the shipped defaults on a posix host #when the process runner is built #then children run as daemon sessions", () => {
    // given / when
    const runner = buildProcessChildRunner(buildContext(settingsOf(), "darwin"))

    // then
    expect(runner).toBeInstanceOf(RpcHostRunner)
  })

  test("#given task.process_runner child-process #when the process runner is built #then the per-child runner is used", () => {
    // given / when
    const runner = buildProcessChildRunner(buildContext(settingsOf({ process_runner: "child-process" }), "linux"))

    // then
    expect(runner).toBeInstanceOf(RpcProcessRunner)
  })

  test("#given win32 #when the process runner is built #then the per-child runner is used even with process_runner host", () => {
    // given / when
    const runner = buildProcessChildRunner(buildContext(settingsOf({ process_runner: "host" }), "win32"))

    // then
    expect(runner).toBeInstanceOf(RpcProcessRunner)
  })
})

describe("host execution mode gate", () => {
  function gateFor(input: {
    readonly settings: OmoTaskSettings
    readonly platform: NodeJS.Platform
    readonly ensure: () => Promise<{ readonly socket: string; readonly capabilities?: readonly string[] }>
    readonly notices: ReturnType<typeof createHostNotices>
  }) {
    return createHostExecutionModeGate({
      settings: input.settings,
      platform: input.platform,
      agentDir: "/tmp/dh-agent",
      env: {},
      notices: input.notices,
      routing: routingFor({
        settings: input.settings,
        notices: input.notices,
        ensureDaemon: async () => {
          const ensured = await input.ensure()
          return {
            action: "reuse",
            reason: "compatible",
            socket: ensured.socket,
            pid: 1234,
            reused: true,
            upgradeable: true,
            ...(ensured.capabilities === undefined ? {} : { capabilities: ensured.capabilities }),
          }
        },
      }),
    })
  }

  test("#given an agent dir whose store index cannot be written #when the first spawn asks the gate #then no host is ensured", async () => {
    // given - a regular file where the rpc directory would go makes the index unwritable
    const agentDir = mkdtempSync(join(tmpdir(), "omo-gate-admit-"))
    const storeDir = mkdtempSync(join(tmpdir(), "omo-gate-store-"))
    await Bun.write(join(agentDir, "rpc"), "not a directory")
    const notices = createHostNotices(() => {})
    const settings = settingsOf()
    let ensures = 0
    const gate = createHostExecutionModeGate({
      settings,
      platform: "darwin",
      agentDir,
      env: {},
      notices,
      storeDir,
      routing: routingFor({
        settings,
        notices,
        ensureDaemon: () => {
          ensures += 1
          return Promise.reject(new Error("must not ensure"))
        },
      }),
    })

    try {
      // when
      const mode = await gate.ensure()

      // then - the spawn goes to the host runner, which reports store_index_unavailable itself
      expect(mode).toBe("process")
      expect(ensures).toBe(0)
      expect(gate.current()).toBeUndefined()
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
      rmSync(storeDir, { recursive: true, force: true })
    }
  })

  test("#given a daemon advertising session context and generation handoff #when the gate resolves #then process mode is the effective default", async () => {
    // given
    const notices = createHostNotices(() => {})
    const gate = gateFor({
      settings: settingsOf(),
      platform: "darwin",
      notices,
      ensure: () =>
        Promise.resolve({ socket: "/tmp/dh-agent/rpc/rpc.sock", capabilities: ["session_context", "generation_handoff"] }),
    })

    // when
    const mode = await gate.ensure()

    // then
    expect(mode).toBe("process")
    expect(notices.list()).toEqual([])
  })

  test("#given a daemon without generation_handoff #when the gate resolves #then in-process is the effective default and one capability notice is recorded", async () => {
    // given
    const notices = createHostNotices(() => {})
    const gate = gateFor({
      settings: settingsOf(),
      platform: "darwin",
      notices,
      ensure: () => Promise.resolve({ socket: "/tmp/dh-agent/rpc/rpc.sock", capabilities: ["session_context"] }),
    })

    // when
    const mode = await gate.ensure()
    await gate.ensure()

    // then
    expect(mode).toBe("in-process")
    expect(notices.list().filter((notice) => notice.startsWith("host_unavailable:capability"))).toHaveLength(1)
  })

  test("#given an ensure that refuses for capability #when the gate resolves #then in-process wins and exactly one token is recorded", async () => {
    // given
    const notices = createHostNotices(() => {})
    const gate = createHostExecutionModeGate({
      settings: settingsOf(),
      platform: "darwin",
      agentDir: "/tmp/dh-agent",
      env: {},
      notices,
      routing: routingFor({
        settings: settingsOf(),
        notices,
        ensureDaemon: () =>
          Promise.reject(new HostUnavailableError("capability", { fallbackAllowed: true, detail: "missing session_context" })),
      }),
    })

    // when
    const mode = await gate.ensure()
    await gate.ensure()

    // then
    expect(mode).toBe("in-process")
    expect(notices.list()).toHaveLength(1)
    expect(notices.list()[0]).toContain("host_unavailable:capability")
  })

  test("#given win32 or the child-process runner #when the gate resolves #then the daemon is never ensured", async () => {
    // given
    const notices = createHostNotices(() => {})
    let ensures = 0
    const ensure = (): Promise<{ readonly socket: string }> => {
      ensures += 1
      return Promise.resolve({ socket: "/tmp/dh-agent/rpc/rpc.sock" })
    }

    // when
    const onWindows = await gateFor({ settings: settingsOf(), platform: "win32", notices, ensure }).ensure()
    const perChild = await gateFor({
      settings: settingsOf({ process_runner: "child-process" }),
      platform: "darwin",
      notices,
      ensure,
    }).ensure()

    // then
    expect([onWindows, perChild]).toEqual(["in-process", "in-process"])
    expect(ensures).toBe(0)
  })
})

describe("host notices", () => {
  test("#given the same fallback reason twice #when recorded #then the notice list holds exactly one entry", () => {
    // given
    const logged: string[] = []
    const notices = createHostNotices((message) => logged.push(message))

    // when
    notices.add("host_unavailable:capability - task children run as their own process: a")
    notices.add("host_unavailable:capability - task children run as their own process: b")
    notices.add("host_unavailable:win32 - task children run as their own process")

    // then
    expect(notices.list()).toHaveLength(2)
    expect(logged).toHaveLength(2)
  })
})
