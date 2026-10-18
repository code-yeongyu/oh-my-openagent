import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startFakeHost, type FakeHost, type FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import type { EnsuredTaskDaemon } from "./rpc-host/daemon"
import type { ShardResolution } from "./rpc-host/shard-socket"
import { HostSessionClient } from "./rpc-host/session-client"
import { RpcHostRunner, type HostSessionChannel, type RpcHostRunnerOptions } from "./rpc-host"
import type { ChildExitOutcome, RpcChildHandle, RpcRunnerSpec } from "./types"

/** The child every suite in this file starts: a plain (non-member, non-DAG) process child. */
export const CHILD_STATE_DIR = "/tmp/dh-30-state"

export function childSpec(overrides: Partial<RpcRunnerSpec> = {}): RpcRunnerSpec {
  return {
    task_id: "st_30",
    cwd: "/tmp/dh-30-cwd",
    state_dir: CHILD_STATE_DIR,
    prompt: "do the daemon child work",
    model: "anthropic/claude-sonnet-4-5",
    reasoning: "high",
    ...overrides,
  }
}

export function ensuredDaemon(socket: string): EnsuredTaskDaemon {
  return {
    action: "reuse",
    reason: "compatible",
    socket,
    pid: 4242,
    reused: true,
    upgradeable: true,
    instanceId: "fake-instance",
    engineVersion: "2026.9.18",
  }
}

/** A root session's resolution naming `socket` (a fake host's socket is not a `p-*` name). */
export function rootResolution(socket: string, key = "0000000000000000"): ShardResolution {
  return { socket, shard: { kind: "p", key, ownerSessionId: `root-${key}`, inherited: false }, root: "primary" }
}

/**
 * The routing every host runner must carry, pointed at `socket`. `agentDir` receives the store index
 * the runner registers before each open; callers own its cleanup.
 */
export function testRouting(socket: string, agentDir: string) {
  return {
    agentDir,
    storeDir: CHILD_STATE_DIR,
    shardResolver: () => rootResolution(socket),
    ownHostSocket: () => undefined,
    insideHost: () => false,
    onNotice: () => undefined,
    shardEvents: {},
  } as const
}

export interface HostRunnerHarness {
  fakeHost(options?: FakeHostOptions): Promise<FakeHost>
  /** A runner whose daemon IS the given fake host; every override replaces one port. */
  runnerOver(host: FakeHost, overrides?: Partial<RpcHostRunnerOptions>): RpcHostRunner
  /** A runner with no reachable daemon: `ensureDaemon` decides what the start sees. */
  runnerWithout(overrides: Partial<RpcHostRunnerOptions>): RpcHostRunner
  release(): Promise<void>
}

/**
 * Per-suite registry of fake hosts and the session clients the runner opened through them, so a
 * case never leaks a connection into the next one and two checkouts can run the suite at once
 * (every fake host owns its own mkdtemp socket dir).
 */
export function hostRunnerHarness(): HostRunnerHarness {
  const hosts: FakeHost[] = []
  const clients: HostSessionClient[] = []
  const agentDir = join(tmpdir(), `dh-30-agent-${process.pid}-${Math.random().toString(36).slice(2)}`)
  const baseOptions = {
    policy: "upgrade",
    agentDir,
    env: {},
    heartbeatIntervalMs: 60_000,
    closeGraceMs: 50,
    modelAdmission: () => Promise.resolve(),
  } as const satisfies Partial<RpcHostRunnerOptions>
  return {
    fakeHost: async (options) => {
      const host = await startFakeHost(options)
      hosts.push(host)
      return host
    },
    runnerOver: (host, overrides = {}) =>
      new RpcHostRunner({
        ...baseOptions,
        ...testRouting(host.socketPath, ensureDir(agentDir)),
        probeHost: () => host.probeProtocolInfo(),
        ensureDaemon: () => Promise.resolve(ensuredDaemon(host.socketPath)),
        createClient: (socketPath) => {
          const client = new HostSessionClient({
            socketPath,
            ports: { probeProtocolInfo: () => host.probeProtocolInfo() },
          })
          clients.push(client)
          return client
        },
        ...overrides,
      }),
    runnerWithout: (overrides) =>
      new RpcHostRunner({ ...baseOptions, ...testRouting("/tmp/dh-30-unreached.sock", ensureDir(agentDir)), ...overrides }),
    release: async () => {
      for (const client of clients.splice(0)) await client.detach()
      for (const host of hosts.splice(0)) await host.stop()
      rmSync(agentDir, { recursive: true, force: true })
    },
  }
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A throwaway agent dir for a runner built outside the harness. */
export function tempAgentDir(): string {
  return mkdtempSync(join(tmpdir(), "dh-30-agent-"))
}

export interface FakeFallbackRunner {
  readonly starts: readonly RpcRunnerSpec[]
  readonly handle: RpcChildHandle
  start(spec: RpcRunnerSpec): Promise<RpcChildHandle>
}

/** The per-child runner seam: records what it was handed and returns an identifiable handle. */
export function fakeFallbackRunner(): FakeFallbackRunner {
  const starts: RpcRunnerSpec[] = []
  const handle: RpcChildHandle = {
    task_id: "st_30",
    sessionId: "fallback-session",
    pid: 31_337,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => new Promise<ChildExitOutcome>(() => undefined),
    lastSeen: () => undefined,
  }
  return {
    get starts() {
      return starts
    },
    handle,
    start: (spec) => {
      starts.push(spec)
      return Promise.resolve(handle)
    },
  }
}

export interface StubChannel extends HostSessionChannel {
  readonly calls: readonly string[]
}

/**
 * An in-memory session channel for the paths a socket cannot produce on demand - a host that
 * REJECTS the first prompt. Everything else behaves like an open, retained session.
 */
export function stubChannel(sendFailure: Error | undefined): StubChannel {
  const calls: string[] = []
  // Like the real host, get_state reports the model the session was opened with.
  let openedModel: { readonly provider: string; readonly id: string } | undefined
  const record = <T>(name: string, value: T): T => {
    calls.push(name)
    return value
  }
  return {
    socketPath: "/tmp/dh-30-stub/rpc.sock",
    transportGone: new Promise<never>(() => undefined),
    get calls() {
      return calls
    },
    open: (request) => {
      if (request.provider !== undefined && request.modelId !== undefined) openedModel = { provider: request.provider, id: request.modelId }
      return record(
        "open",
        Promise.resolve({
          sessionId: "routing-stub",
          attached: false,
          instanceId: "inst-stub",
          engineVersion: "2026.9.18",
        }),
      )
    },
    send: (command) =>
      record(command.type, sendFailure === undefined ? Promise.resolve() : Promise.reject(sendFailure)),
    getState: () => Promise.resolve({ sessionId: "durable-stub", ...(openedModel === undefined ? {} : { model: openedModel }) }),
    getEntries: () => Promise.resolve({ entries: [], leafId: null }),
    switchSession: () => record("switch_session", Promise.resolve({ cancelled: false })),
    onEvent: (_listener: (event: AgentSessionEvent) => void) => () => undefined,
    onParked: () => () => undefined,
    onClosed: () => () => undefined,
    close: () => record("close", Promise.resolve()),
    detach: () => record("detach", Promise.resolve()),
  }
}
