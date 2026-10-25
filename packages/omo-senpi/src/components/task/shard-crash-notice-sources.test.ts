import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import {
  CHILD_STATE_DIR,
  childSpec,
  ensuredDaemon,
  hostRunnerHarness,
  rootResolution,
} from "../../../../senpi-task/src/runners/rpc-host.test-support"
import { buildProcessChildRunner, buildRespawnRunner, type RunnerBuildContext } from "./engine-runners"
import { createEngineHostRuntime } from "./host-execution-mode"
import { TaskRuntimeContext } from "./runtime-context"
import { createShardCrashNotices, readNewestHostCrash, SHARD_CRASH_DONE_TOKEN, SHARD_CRASH_TOKEN } from "./shard-crash-notice"
import { SOCKET_A, uiRecorder } from "./shard-crash-notice.test-support"

// Where the crash notice's facts come from: the session's host runtime, the real host runner's
// recovery reports, and the endpoint's daemon directory as the engine itself names it.

describe("session host runtime", () => {
  test("#given a session with a captured UI #when its routing reports a crash #then only its diagnostic log gets it", () => {
    // given
    const { ui, notified } = uiRecorder()
    const runtime = new TaskRuntimeContext("/tmp/dh-t10-project")
    runtime.captureFrom({ ui, sessionManager: { getSessionId: () => "01a0e4ae-parent" } })
    const logs: string[] = []
    const host = createEngineHostRuntime(OmoTaskSettingsSchema.parse({}), runtime, {}, {
      agentDir: "/tmp/dh-t10-agent", env: {}, crashLog: (event) => logs.push(event),
    })

    // when
    host.routing.shardEvents.onTransportLost?.({ taskId: "st_a", socket: SOCKET_A, instanceId: "gen-1", turnWasInFlight: true })

    // then
    expect(host.notices.list()).toEqual([])
    expect(notified).toEqual([])
    expect(logs).toEqual([SHARD_CRASH_TOKEN])
  })
})

describe("host runner feeding the crash notice", () => {
  const { fakeHost, runnerOver, release } = hostRunnerHarness()
  afterAll(async () => {
    await release()
  })

  test("#given two children mid-turn on one host #when it recovers #then logs count both and no notice is emitted", async () => {
    // given
    const host = await fakeHost()
    const closed = Promise.withResolvers<void>()
    const logs: Array<{ event: string; facts: Record<string, unknown> }> = []
    const events = createShardCrashNotices({
      agentDir: join(tmpdir(), "dh-t10-no-records"),
      log: (event, facts) => {
        logs.push({ event, facts })
        if (event === SHARD_CRASH_DONE_TOKEN) closed.resolve()
      },
    })
    const runner = runnerOver(host, {
      reattachDelaysMs: [0, 0, 0],
      sleep: () => Promise.resolve(),
      ensureDaemon: () => Promise.resolve({ ...ensuredDaemon(host.socketPath), instanceId: host.instanceId }),
      shardEvents: events,
    })
    const first = await runner.start(childSpec({ task_id: "st_a" }))
    const second = await runner.start(childSpec({ task_id: "st_b" }))

    // when
    await host.restart()
    await closed.promise

    // then
    expect(logs).toMatchObject([
      { event: SHARD_CRASH_TOKEN, facts: { members: 2 } },
      { event: SHARD_CRASH_DONE_TOKEN, facts: { reattached: 2, lost: 0, cancelled: 0 } },
    ])
    await first.terminate()
    await second.terminate()
  })

  test("#given spawned and revived children on one generation #when it recovers #then one diagnostic episode counts both silently", async () => {
    // given - the spawn runner and the respawn runner exactly as the engine builds them for one session
    const host = await fakeHost()
    const agentDir = mkdtempSync(join(tmpdir(), "dh-t10-wiring-"))
    wiringDirs.push(agentDir)
    const closed = Promise.withResolvers<void>()
    const { ui, notified } = uiRecorder()
    const logs: Array<{ event: string; facts: Record<string, unknown> }> = []
    const runtime = new TaskRuntimeContext(agentDir)
    runtime.captureFrom({ ui, sessionManager: { getSessionId: () => "01a0e4ae-parent" } })
    const settings = OmoTaskSettingsSchema.parse({})
    const session = createEngineHostRuntime(settings, runtime, {}, {
      agentDir,
      env: {},
      ensureDaemon: () => Promise.resolve({ ...ensuredDaemon(host.socketPath), instanceId: host.instanceId }),
      probeHost: () => host.probeProtocolInfo(),
      crashLog: (event, facts) => {
        logs.push({ event, facts })
        if (event === SHARD_CRASH_DONE_TOKEN) closed.resolve()
      },
    })
    const build: RunnerBuildContext = {
      runtime,
      sharedParentTools: () => [],
      settings,
      platform: "darwin",
      agentDir,
      env: {},
      hostRouting: { ...session.routing, shardResolver: () => rootResolution(host.socketPath), storeDir: CHILD_STATE_DIR },
    }
    // No model: admission (a real catalog probe) is not what this case is about.
    const spawned = await buildProcessChildRunner(build).start(childSpec({ task_id: "st_spawned", model: undefined, extensions: [] }))
    const revived = await buildRespawnRunner(build).start(childSpec({ task_id: "st_revived", model: undefined, extensions: [] }))

    // when
    await host.restart()
    await closed.promise

    // then
    expect(session.notices.list()).toEqual([])
    expect(notified).toEqual([])
    expect(logs).toMatchObject([
      { event: SHARD_CRASH_TOKEN, facts: { members: 2 } },
      { event: SHARD_CRASH_DONE_TOKEN, facts: { reattached: 2, lost: 0, cancelled: 0 } },
    ])
    await spawned.terminate()
    await revived.terminate()
  })
})

const wiringDirs: string[] = []
afterAll(() => {
  for (const dir of wiringDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("readNewestHostCrash", () => {
  const dirs: string[] = []
  let createHostDaemonPaths: Awaited<ReturnType<typeof loadSenpiBarrel>>["createHostDaemonPaths"]
  beforeAll(async () => {
    ;({ createHostDaemonPaths } = await loadSenpiBarrel())
  })
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function engineDaemonDir(): { readonly agentDir: string; readonly dir: string } {
    const agentDir = mkdtempSync(join(tmpdir(), "dh-t10-agent-"))
    dirs.push(agentDir)
    const dir = createHostDaemonPaths({ agentDir, socket: SOCKET_A }).dir
    mkdirSync(dir, { recursive: true })
    return { agentDir, dir }
  }

  test("#given a fresh signalled record and the lost generation's supervisor record in the engine's daemon dir #when read #then supervisor pid and signal come back", () => {
    // given
    const { agentDir, dir } = engineDaemonDir()
    mkdirSync(join(dir, "generations", "gen-1"), { recursive: true })
    writeFileSync(join(dir, "generations", "gen-1", "host.pid"), JSON.stringify({ pid: 777 }))
    const at = Date.parse("2026-09-27T12:00:00.000Z")
    writeFileSync(
      join(dir, "crashes.jsonl"),
      `${JSON.stringify({ at: "2026-09-26T12:00:00.000Z", code: 3, uptimeMs: 1 })}\n${JSON.stringify({ at: new Date(at - 1_000).toISOString(), signal: "SIGSEGV", uptimeMs: 5 })}\n`,
    )

    // when
    const facts = readNewestHostCrash(agentDir, SOCKET_A, "gen-1", at)

    // then
    expect(facts).toEqual({ supervisorPid: 777, cause: "SIGSEGV" })
  })

  test("#given only an old record and no generation file #when read #then nothing is attributed to this crash", () => {
    // given
    const { agentDir, dir } = engineDaemonDir()
    writeFileSync(join(dir, "crashes.jsonl"), `${JSON.stringify({ at: "2026-09-20T12:00:00.000Z", signal: "SIGBUS", uptimeMs: 1 })}\n`)

    // when
    const facts = readNewestHostCrash(agentDir, SOCKET_A, "gen-1", Date.parse("2026-09-27T12:00:00.000Z"))

    // then
    expect(facts).toEqual({})
  })
})
