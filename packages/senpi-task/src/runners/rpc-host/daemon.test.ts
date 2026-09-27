import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  EnsureHostInput,
  HostDecision,
  HostEnginePolicy,
  SenpiHostProtocolInfo,
  TaskDaemonHostPort,
} from "../../lazy/senpi-barrel"
import { DAEMON_LAUNCH_FIXTURE } from "./__fixtures__/daemon-launch"
import {
  daemonLaunchOptions,
  ensureTaskDaemon,
  HostUnavailableError,
  resolveTaskHostSocket,
  TASK_DAEMON_REQUIRED_CAPABILITIES,
  TASK_HOST_SOCKET_ENV_NAMES,
} from "./daemon"

const ENGINE_TEXT = "2026.9.18+1758000000.abc1234"

function protocolInfo(overrides: Partial<SenpiHostProtocolInfo> = {}): SenpiHostProtocolInfo {
  return {
    protocolVersion: 1,
    instanceId: "instance-a",
    generation: 1,
    engineVersion: ENGINE_TEXT,
    engineOrdinal: [2026, 9, 18, 0, 1_758_000_000],
    capabilities: [...TASK_DAEMON_REQUIRED_CAPABILITIES, "generation_handoff"],
    ...overrides,
  }
}

/**
 * An in-memory FAKE of the senpi host API, not a mock: `decideHostAction` re-implements the subset
 * of the engine's published truth table (senpi host-decision.ts) this todo depends on, so a test
 * that expects `fallback:engine_mismatch` only gets it when the host's engineVersion really differs
 * under policy `fallback`. The engine owns the authoritative table and its own test.
 */
function fakeHostPort(options: {
  readonly host?: SenpiHostProtocolInfo | undefined
  readonly ensure?: (input: EnsureHostInput) => Promise<{ pid: number; socket: string; reused: boolean }>
} = {}): TaskDaemonHostPort & { readonly probes: string[]; readonly ensured: EnsureHostInput[] } {
  const probes: string[] = []
  const ensured: EnsureHostInput[] = []
  return {
    probes,
    ensured,
    engineBuildIdentity: () => ({ text: ENGINE_TEXT, ordinal: [2026, 9, 18, 0, 1_758_000_000], scheme: "epoch" }),
    probeHost: async ({ socket }) => {
      probes.push(socket)
      return options.host
    },
    decideHostAction: (client, host, policy): HostDecision => {
      if (host === undefined) return { action: "start", reason: "no_host", upgradeable: false }
      if (host.protocolVersion !== client.protocolVersion) {
        return { action: "refuse", reason: "protocol", upgradeable: false }
      }
      const missing = client.requiredCapabilities.filter((name) => !host.capabilities.includes(name))
      if (missing.length > 0) {
        return { action: policy === "fallback" ? "fallback" : "refuse", reason: "capability", upgradeable: false }
      }
      const engineDiffers = host.engineVersion !== client.identity.text
      if (policy === "fallback" && engineDiffers) {
        return { action: "fallback", reason: "engine_mismatch", upgradeable: true }
      }
      if (policy === "upgrade" && engineDiffers && host.capabilities.includes("generation_handoff")) {
        return { action: "handoff", reason: "newer_engine", upgradeable: true }
      }
      return { action: "reuse", reason: "compatible", upgradeable: host.capabilities.includes("generation_handoff") }
    },
    ensureHost: async (input) => {
      ensured.push(input)
      if (options.ensure !== undefined) return await options.ensure(input)
      return { pid: 4242, socket: input.socket, reused: true }
    },
  }
}

// The ensured result is cached per SOCKET, so every case gets its own agent dir and therefore its
// own cache slot; the cache cases below opt into a shared one on purpose.
let agentDirSeq = 0

function ensureInput(
  host: TaskDaemonHostPort,
  overrides: { readonly policy?: HostEnginePolicy; readonly agentDir?: string; readonly now?: () => number } = {},
) {
  agentDirSeq += 1
  return {
    agentDir: overrides.agentDir ?? join("/tmp", `agent-${agentDirSeq}`),
    env: DAEMON_LAUNCH_FIXTURE.parentEnv,
    policy: overrides.policy ?? ("upgrade" as HostEnginePolicy),
    ports: {
      host,
      launchSpec: { path: DAEMON_LAUNCH_FIXTURE.specPath, spec: DAEMON_LAUNCH_FIXTURE.spec },
      platform: "darwin" as NodeJS.Platform,
      bunRuntimeAvailable: true,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
  }
}

describe("resolveTaskHostSocket", () => {
  test("#given several socket overrides #when resolving #then the four names win in order and blanks are skipped", () => {
    // given / when / then
    expect(TASK_HOST_SOCKET_ENV_NAMES).toEqual(["OMO_RPC_SOCKET", "SENPI_RPC_SOCKET", "PI_RPC_SOCKET", "OMO_RPC_SOCKET_PATH"])
    const agentDir = join("/h", ".omo", "agent")
    expect(resolveTaskHostSocket({ OMO_RPC_SOCKET: "/brand.sock", SENPI_RPC_SOCKET: "/legacy.sock" }, agentDir)).toBe("/brand.sock")
    expect(resolveTaskHostSocket({ SENPI_RPC_SOCKET: "/legacy.sock", PI_RPC_SOCKET: "/pi.sock" }, agentDir)).toBe("/legacy.sock")
    expect(resolveTaskHostSocket({ PI_RPC_SOCKET: "/pi.sock", OMO_RPC_SOCKET_PATH: "/desktop.sock" }, agentDir)).toBe("/pi.sock")
    expect(resolveTaskHostSocket({ OMO_RPC_SOCKET: "  ", OMO_RPC_SOCKET_PATH: "/desktop.sock" }, agentDir)).toBe("/desktop.sock")
  })

  test("#given no socket override #when resolving #then the agent dir's public rpc socket is used", () => {
    // given / when / then
    expect(resolveTaskHostSocket({}, join("/h", ".omo", "agent"))).toBe(join("/h", ".omo", "agent", "rpc", "rpc.sock"))
  })
})

describe("daemonLaunchOptions", () => {
  test("#given the shared spec fixture #when building the launch #then hostArgs, nulled env, policy and upgrade match the fixture", () => {
    // given
    const { spec, specPath, parentEnv, idleExitMs, expected } = DAEMON_LAUNCH_FIXTURE

    // when
    const options = daemonLaunchOptions({ spec, specPath, parentEnv, idleExitMs, policy: "upgrade" })

    // then
    expect(options.hostArgs).toEqual([...expected.hostArgs])
    expect(options.env).toEqual({ ...expected.env })
    expect(options.policy).toEqual({ ...expected.policy })
    expect(options.upgrade).toBe(expected.upgrade)
  })

  test("#given a parent idle-eviction window longer than the idle-exit window #when building #then the longer window survives", () => {
    // given
    const { spec, specPath, idleExitMs } = DAEMON_LAUNCH_FIXTURE
    const parentEnv = { SENPI_RPC_SESSION_IDLE_EVICTION_MS: "1800000" }

    // when
    const options = daemonLaunchOptions({ spec, specPath, parentEnv, idleExitMs, policy: "upgrade" })

    // then
    expect(options.env["SENPI_RPC_SESSION_IDLE_EVICTION_MS"]).toBe("1800000")
  })

  test("#given a non-upgrade policy #when building #then the daemon is never told to hand off", () => {
    // given
    const { spec, specPath, parentEnv, idleExitMs } = DAEMON_LAUNCH_FIXTURE

    // when
    const fallback = daemonLaunchOptions({ spec, specPath, parentEnv, idleExitMs, policy: "fallback" })
    const never = daemonLaunchOptions({ spec, specPath, parentEnv, idleExitMs, policy: "never" })

    // then
    expect(fallback.upgrade).toBe("never")
    expect(never.upgrade).toBe("never")
  })
})

describe("ensureTaskDaemon", () => {
  test("#given a compatible running host #when ensuring #then the daemon is reused with the spec's launch and the upgrade marker", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo() })
    const input = ensureInput(host)

    // when
    const ensured = await ensureTaskDaemon(input)

    // then
    expect(ensured.action).toBe("reuse")
    expect(ensured.reused).toBe(true)
    expect(ensured.socket).toBe(join(input.agentDir, "rpc", "rpc.sock"))
    expect(host.ensured).toHaveLength(1)
    expect(host.ensured[0]?.hostArgs).toEqual([...DAEMON_LAUNCH_FIXTURE.expected.hostArgs])
    expect(host.ensured[0]?.upgrade).toBe("if-engine-differs")
  })

  test("#given no host on the socket #when ensuring #then the daemon is started", async () => {
    // given
    const host = fakeHostPort({ host: undefined, ensure: async (input) => ({ pid: 7, socket: input.socket, reused: false }) })

    // when
    const ensured = await ensureTaskDaemon(ensureInput(host))

    // then
    expect(ensured.action).toBe("start")
    expect(ensured.reused).toBe(false)
    expect(ensured.pid).toBe(7)
  })

  test("#given a host missing a required capability #when ensuring under policy never #then it refuses with a fallback-allowed capability reason", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo({ capabilities: ["multi_session", "extension_events"] }) })

    // when
    const failure = await ensureTaskDaemon(ensureInput(host, { policy: "never" })).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("capability")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(true)
    expect(host.ensured).toHaveLength(0)
  })

  test("#given a host on another protocol version #when ensuring #then it refuses WITHOUT allowing the per-child fallback", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo({ protocolVersion: 2 }) })

    // when
    const failure = await ensureTaskDaemon(ensureInput(host, { policy: "never" })).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("protocol")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(false)
  })

  test("#given policy fallback #when the host engine version differs #then engine_mismatch falls back, and an equal version does not", async () => {
    // given
    const differing = fakeHostPort({ host: protocolInfo({ engineVersion: "2026.9.16-3" }) })
    const equal = fakeHostPort({ host: protocolInfo() })

    // when
    const failure = await ensureTaskDaemon(ensureInput(differing, { policy: "fallback" })).catch((error: unknown) => error)
    const ensured = await ensureTaskDaemon(ensureInput(equal, { policy: "fallback" }))

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("engine_mismatch")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(true)
    expect(differing.ensured).toHaveLength(0)
    expect(ensured.action).toBe("reuse")
  })

  test("#given policy upgrade and an older running host #when ensuring #then the engine is asked to hand off", async () => {
    // given
    const host = fakeHostPort({
      host: protocolInfo({ engineVersion: "2026.9.16-3" }),
      ensure: async (input) => ({ pid: 99, socket: input.socket, reused: false }),
    })

    // when
    const ensured = await ensureTaskDaemon(ensureInput(host, { policy: "upgrade" }))

    // then
    expect(ensured.action).toBe("handoff")
    expect(host.ensured[0]?.upgrade).toBe("if-engine-differs")
  })

  test("#given an ensure that cannot write the socket directory #when ensuring #then ensure_failed carries a sanitized cause", async () => {
    // given
    const home = homedir()
    const host = fakeHostPort({
      host: protocolInfo(),
      ensure: async () => {
        throw new Error(`EACCES: permission denied, mkdir '${home}/.omo/agent/rpc'\n  at startHost (${home}/engine.js:1:1)`)
      },
    })

    // when
    const failure = await ensureTaskDaemon(ensureInput(host)).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("ensure_failed")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(false)
    expect((failure as HostUnavailableError).message).toContain("EACCES")
    expect((failure as HostUnavailableError).message).toContain("~/.omo/agent/rpc")
    expect((failure as HostUnavailableError).message).not.toContain(home)
    expect((failure as HostUnavailableError).message).not.toContain("\n")
  })

  test("#given win32 #when ensuring #then it refuses to the per-child runner without probing the machine", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo() })
    const input = ensureInput(host)

    // when
    const failure = await ensureTaskDaemon({ ...input, ports: { ...input.ports, platform: "win32" } }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("win32")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(true)
    expect(host.probes).toHaveLength(0)
  })

  test("#given a Node runtime with no discoverable bun #when ensuring #then it refuses to the per-child runner without probing", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo() })
    const input = ensureInput(host)

    // when
    const failure = await ensureTaskDaemon({ ...input, ports: { ...input.ports, bunRuntimeAvailable: false } }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect((failure as HostUnavailableError).reason).toBe("runtime")
    expect((failure as HostUnavailableError).fallbackAllowed).toBe(true)
    expect(host.probes).toHaveLength(0)
  })

  test("#given a successful ensure #when another ensure runs #then the result is cached for 5 s and re-probed after it", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo() })
    let clock = 1_000
    const input = ensureInput(host, { agentDir: join("/tmp", "agent-cache"), now: () => clock })

    // when
    await ensureTaskDaemon(input)
    clock = 5_999
    await ensureTaskDaemon(input)
    const probesWhileCached = host.probes.length
    clock = 6_001
    await ensureTaskDaemon(input)

    // then
    expect(probesWhileCached).toBe(1)
    expect(host.probes).toHaveLength(2)
  })

  test("#given a refused ensure #when it is retried #then nothing was cached and the host is probed again", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo({ protocolVersion: 2 }) })
    const input = ensureInput(host, { agentDir: join("/tmp", "agent-refused") })

    // when
    await ensureTaskDaemon(input).catch(() => undefined)
    await ensureTaskDaemon(input).catch(() => undefined)

    // then
    expect(host.probes).toHaveLength(2)
  })

})

// What the ensured daemon can do decides `task.default_execution_mode: "auto"`, so the ensure hands
// the capability list back to its caller instead of every caller re-probing the socket.
describe("ensureTaskDaemon capabilities", () => {
  test("#given a daemon already running #when ensured #then the probed capability list rides the result", async () => {
    // given
    const host = fakeHostPort({ host: protocolInfo() })

    // when
    const ensured = await ensureTaskDaemon(ensureInput(host))

    // then
    expect(ensured.action).toBe("reuse")
    expect(ensured.capabilities).toEqual([...TASK_DAEMON_REQUIRED_CAPABILITIES, "generation_handoff"])
  })

  test("#given a daemon this call had to start #when ensured #then the fresh host is probed once for its capabilities", async () => {
    // given
    let started = false
    const host = fakeHostPort({
      host: undefined,
      ensure: async (input) => {
        started = true
        return { pid: 4242, socket: input.socket, reused: false }
      },
    })
    const withStartedHost: typeof host = {
      ...host,
      probeHost: async ({ socket }) => {
        host.probes.push(socket)
        return started ? protocolInfo({ capabilities: ["multi_session", "generation_handoff"] }) : undefined
      },
    }

    // when
    const ensured = await ensureTaskDaemon(ensureInput(withStartedHost))

    // then
    expect(ensured.action).toBe("start")
    expect(ensured.capabilities).toEqual(["multi_session", "generation_handoff"])
    expect(host.probes).toHaveLength(2)
  })

  test("#given a started daemon that answers no probe #when ensured #then the capabilities are absent instead of guessed", async () => {
    // given
    const host = fakeHostPort({ host: undefined, ensure: async (input) => ({ pid: 7, socket: input.socket, reused: false }) })

    // when
    const ensured = await ensureTaskDaemon(ensureInput(host))

    // then
    expect(ensured.capabilities).toBeUndefined()
  })
})
