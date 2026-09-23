import { afterEach, describe, expect, test } from "bun:test"

import { realColdReviveHostSession } from "../lifecycle/__fixtures__/real-cold-revive"
import type { ReconcileOutcome } from "../lifecycle"
import type { FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import { listFakeHostSessions } from "./rpc-host/__fixtures__/fake-host-probe"
import { startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"

/**
 * Two omo parents, one machine-wide daemon, 32 children: the integration contract of the daemon
 * runner. Nothing here reaches the network, a provider or a real engine - the daemon is a fake host
 * on a private unix socket, and every wait is recorded instead of slept.
 */

const CHILDREN_PER_PARENT = 16
const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

async function daemonWorld(options: FakeHostOptions = {}): Promise<HostWorld> {
  const world = await startHostWorld(options)
  worlds.push(world)
  return world
}

async function twoParents(
  options: FakeHostOptions = {},
  parentOptions: Parameters<HostWorld["connect"]>[1] = {},
): Promise<{ readonly world: HostWorld; readonly a: ParentSession; readonly b: ParentSession }> {
  const world = await daemonWorld(options)
  const a = world.connect("parent-a", parentOptions)
  const b = world.connect("parent-b", parentOptions)
  await a.startChildren(CHILDREN_PER_PARENT)
  await b.startChildren(CHILDREN_PER_PARENT)
  return { world, a, b }
}

function distinct<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

function of(outcomes: readonly ReconcileOutcome[], kind: string, reason?: string): readonly ReconcileOutcome[] {
  return outcomes.filter((outcome) => outcome.kind === kind && (reason === undefined || outcome.reason === reason))
}

function contextRole(session: { readonly context: unknown }): unknown {
  const context = session.context
  return typeof context === "object" && context !== null && "role" in context ? context.role : undefined
}

describe("two parents on one daemon", () => {
  test("#given two parent sessions sharing one daemon #when each starts 16 children #then it holds 32 retained worker sessions, hidden from a default listing, with nothing errored", async () => {
    // given / when
    const { world, a, b } = await twoParents()

    // then
    const sessions = world.host.sessions()
    expect(sessions).toHaveLength(32)
    expect(distinct(sessions.map((session) => session.sessionPath))).toHaveLength(32)
    expect(distinct(sessions.map((session) => session.kind))).toEqual(["worker"])
    expect(distinct(sessions.map(contextRole))).toEqual(["child"])
    expect(distinct(sessions.map((session) => session.retainOnDisconnect))).toEqual([true])
    expect(distinct(sessions.map((session) => session.autoTitle))).toEqual([false])
    expect(distinct(sessions.map((session) => session.attachments))).toEqual([1])
    // I4: a worker session is invisible until a client asks for one.
    expect(await listFakeHostSessions(world.host.socketPath)).toEqual([])
    expect(await listFakeHostSessions(world.host.socketPath, { includeWorkers: true })).toHaveLength(32)

    const records = [...a.records(), ...b.records()]
    expect(records).toHaveLength(32)
    expect(distinct(records.map((record) => record.status))).toEqual(["running"])
    expect(distinct(records.map((record) => record.residency_state))).toEqual(["resident"])
    expect(distinct(records.map((record) => record.runner_kind))).toEqual(["host-session"])
    expect(distinct(records.map((record) => record.pid))).toEqual([undefined])
    expect(world.prompts()).toHaveLength(32)
    expect([...a.warnings, ...b.warnings]).toEqual([])
  })

  test("#given 32 live children #when parent A shuts down #then its 16 sessions stay on the daemon and only its records park", async () => {
    // given
    const { world, a, b } = await twoParents()
    const parkedPaths = new Set(a.sessionPaths())

    // when
    const summary = await a.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-a", reason: "session_shutdown" })
    // The daemon's own view settles when the 16 detached connections are gone - parent B keeps 16.
    await world.host.waitForConnections(16)

    // then
    expect(summary.suspended_rpc).toBe(16)
    expect(summary.failures).toEqual([])
    expect(world.commandsOfType("close_session")).toBe(0)
    const retained = world.host.sessions().filter((session) => parkedPaths.has(session.sessionPath))
    expect(retained).toHaveLength(16)
    expect(distinct(retained.map((session) => session.attachments))).toEqual([0])
    expect(distinct(retained.map((session) => session.parked))).toEqual([false])
    expect(world.host.sessions()).toHaveLength(32)
    expect(distinct(a.records().map((record) => record.residency_state))).toEqual(["rpc_detached"])
    expect(distinct(b.records().map((record) => record.residency_state))).toEqual(["resident"])
    expect(distinct([...a.records(), ...b.records()].map((record) => record.status))).toEqual(["running"])
  })

  test("#given a parent that parked its 16 children #when it starts a new session #then all 16 reattach without replaying a prompt", async () => {
    // given
    const { world, a } = await twoParents()
    await a.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-a", reason: "session_shutdown" })
    await world.host.waitForConnections(16)
    const paths = a.sessionPaths()

    // when
    const restarted = world.connect("parent-a")
    const result = await restarted.lifecycle.reconcileOnSessionStart("parent-a")

    // then
    expect(of(result.outcomes, "resumed")).toHaveLength(16)
    expect(of(result.outcomes, "deferred", "foreign_live_owner")).toHaveLength(16)
    expect(of(result.outcomes, "lost")).toEqual([])
    expect(world.prompts()).toHaveLength(32)
    expect(world.commandsOfType("switch_session")).toBe(0)
    expect(distinct(restarted.records().map((record) => record.residency_state))).toEqual(["resident"])
    expect(distinct(restarted.records().map((record) => record.status))).toEqual(["running"])
    expect(distinct(paths.map((path) => world.host.peakAttachments(path)))).toEqual([1])
    expect(world.host.sessions()).toHaveLength(32)
  })

  test("#given a daemon that died under 32 live children #when they park and it comes back #then the next session start reconciles every child", async () => {
    // given
    const { world, a, b } = await twoParents()
    // Pin the idle branch before the crash. The revival contract splits on whether a turn was in
    // flight: a mid-turn restart reopens and re-prompts exactly once, an idle one reopens with no
    // prompt. `startChildren` returns once each child has STARTED, not once its opening turn has
    // ended, so leaving that unpinned lets the platform pick the branch - it read as idle on POSIX
    // and as mid-turn on win32, where 32 re-prompts doubled `prompts()` to 64. This test asserts
    // the idle branch, so it has to establish it.
    for (const session of world.host.sessions()) world.host.completeTurn(session.routingId, "done")

    // when - the park claims every record in THIS tick, before any crashed outcome can land
    world.host.crash()
    const parked = await Promise.all([
      ...a.taskIds().map((taskId) => a.lifecycle.parkHostSessionOnDaemonLoss(taskId)),
      ...b.taskIds().map((taskId) => b.lifecycle.parkHostSessionOnDaemonLoss(taskId)),
    ])

    // then - bounded reconcile, then parked for good; never lost, never signalled
    expect(distinct(parked.map((outcome) => outcome.kind))).toEqual(["suspended"])
    expect(distinct(a.waits)).toEqual([1_000, 4_000, 16_000])
    expect(a.waits).toHaveLength(48)
    const down = [...a.records(), ...b.records()]
    expect(distinct(down.map((record) => record.residency_state))).toEqual(["rpc_detached"])
    expect(distinct(down.map((record) => record.suspension_reason))).toEqual(["daemon_unavailable"])
    expect(distinct(down.map((record) => record.status))).toEqual(["running"])

    // when - a new generation answers on the same socket and both parents start a session
    await world.host.restart()
    const a2 = world.connect("parent-a")
    const b2 = world.connect("parent-b")
    const outcomes = [
      ...(await a2.lifecycle.reconcileOnSessionStart("parent-a")).outcomes,
      ...(await b2.lifecycle.reconcileOnSessionStart("parent-b")).outcomes,
    ]

    // then
    expect(of(outcomes, "resumed")).toHaveLength(32)
    expect(of(outcomes, "lost")).toEqual([])
    expect(world.host.sessions()).toHaveLength(32)
    expect(world.prompts()).toHaveLength(32)
    const revived = [...a2.records(), ...b2.records()]
    expect(distinct(revived.map((record) => record.residency_state))).toEqual(["resident"])
    expect(distinct(revived.map((record) => record.suspension_reason))).toEqual([undefined])
  })

  test("#given a handoff mid-turn #when the old generation still holds the session paths #then revival defers as host_draining and attaches once it drains", async () => {
    // given
    const world = await daemonWorld({ drainRetryAfterMs: 250 })
    const b = world.connect("parent-b", { maxDrainAttempts: 2 })
    await b.startChildren(CHILDREN_PER_PARENT)
    const paths = b.sessionPaths()
    const beforeHandoff = world.host.instanceId

    // when - a newer generation takes the socket and the old one drains
    world.host.handoff()
    await b.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-b", reason: "host_handoff" })
    await world.host.waitForConnections(0)
    const b2 = world.connect("parent-b", { maxDrainAttempts: 2 })
    const draining = await b2.lifecycle.reconcileOnSessionStart("parent-b")

    // then
    expect(world.host.instanceId).not.toBe(beforeHandoff)
    expect(of(draining.outcomes, "deferred", "host_draining")).toHaveLength(16)
    expect(of(draining.outcomes, "lost")).toEqual([])
    expect(distinct(b2.records().map((record) => record.suspension_reason))).toEqual(["host_draining"])
    expect(distinct(b2.records().map((record) => record.residency_state))).toEqual(["rpc_detached"])
    expect(distinct(b2.waits)).toEqual([250])

    // when - the old generation finishes draining
    for (const path of paths) world.host.releasePath(path)
    const attached = await b2.lifecycle.reconcileOnSessionStart("parent-b")

    // then - one session per path, one writer per JSONL, no replayed prompt
    expect(of(attached.outcomes, "resumed")).toHaveLength(16)
    expect(world.host.sessions()).toHaveLength(16)
    expect(distinct(paths.map((path) => world.host.peakAttachments(path)))).toEqual([1])
    expect(distinct(b2.records().map((record) => record.host_session?.instance_id))).toEqual([world.host.instanceId])
    expect(distinct(b2.records().map((record) => record.suspension_reason))).toEqual([undefined])
    expect(world.prompts()).toHaveLength(16)
  })
})

describe("daemon refusals", () => {
  test("#given a daemon without session_context #when both parents start their children #then all 32 run on the per-child runner and each parent warns once", async () => {
    // given
    const { world, a, b } = await twoParents(
      { capabilities: ["multi_session", "extension_events", "session_kind", "retain_on_disconnect"] },
      { useFallback: true },
    )

    // then
    expect(a.fallbackStarts).toHaveLength(16)
    expect(b.fallbackStarts).toHaveLength(16)
    const warnings = [...a.warnings, ...b.warnings]
    expect(warnings).toHaveLength(2)
    expect(distinct(warnings.map((warning) => warning.split(" - ")[0]))).toEqual(["host_unavailable:capability"])
    expect(world.host.sessions()).toEqual([])
    expect(world.commandsOfType("open_session")).toBe(0)
    const records = [...a.records(), ...b.records()]
    expect(records).toHaveLength(32)
    expect(distinct(records.map((record) => record.status))).toEqual(["running"])
    expect(distinct(records.map((record) => record.runner_kind))).toEqual([undefined])
    expect(distinct(records.map((record) => record.pid === undefined))).toEqual([false])
  })

  test("#given a daemon that refuses the launch profile #when a child starts #then the start fails typed and no session and no child process exist", async () => {
    // given
    const world = await daemonWorld()
    const a = world.connect("parent-a", { useFallback: true })
    world.host.failOpen({ code: "invalid_launch_profile", detail: "the daemon loads another extension set" })

    // when
    const [started] = await a.startChildren(1)

    // then - an unusable launch profile is NOT a fallback reason: nothing runs as its own process
    expect(started?.kind).toBe("start_failed")
    expect(world.host.sessions()).toEqual([])
    expect(a.fallbackStarts).toEqual([])
    expect(a.warnings).toEqual([])
    expect(distinct(a.records().map((record) => record.status))).toEqual(["error"])
  })

  test("#given a stalled daemon asking a child for UI #when the notice and the request arrive #then the child answers without a human and stays live", async () => {
    // given
    const world = await daemonWorld()
    const a = world.connect("parent-a")
    await a.startChildren(1)
    const session = world.host.sessions()[0]
    const answered = world.host.waitForCommand("extension_ui_response")

    // when
    world.host.stall(1_200)
    world.host.requestUi(session?.routingId ?? "", { id: "ui-1", method: "confirm", title: "Delete?", message: "really?" })

    // then
    expect((await answered).payload.id).toBe("ui-1")
    expect(world.host.sessions()).toHaveLength(1)
    expect(distinct(a.records().map((record) => record.status))).toEqual(["running"])
  })
})

describe("cold revival of a daemon-hosted child", () => {
  test("#given an idle-parked daemon child #when task_send targets it #then the session reopens once and delivers without replaying the prompt", async () => {
    // given / when
    const result = await realColdReviveHostSession()

    // then
    expect(result.parkedResidency).toBe("rpc_detached")
    expect(result.sendOutcome).toBe("revived")
    expect(result.revivedResidency).toBe("resident")
    expect(result.revivedStatus).toBe("running")
    expect(result.finalResponse).toBe("COLD_HOST_SENTINEL")
    expect(result.prompts.filter((prompt) => prompt.startsWith("host child"))).toHaveLength(1)
    expect(result.prompts).toContain("CONTINUE_HOST_SENTINEL")
    expect(result.opens).toBe(2)
    expect(result.peakAttachments).toBe(1)
    expect(result.transcriptRetained).toBe(true)
  })
})
