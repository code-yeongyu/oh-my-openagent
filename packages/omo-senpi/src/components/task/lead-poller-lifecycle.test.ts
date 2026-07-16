import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import type { Message } from "@oh-my-opencode/team-core/types"
import { WaitRegistry, toTeamCoreConfig, type LeadInjection } from "@oh-my-opencode/senpi-task"

import type { IdleInjection } from "../../extension/idle-injection-coordinator"
import { createLeadPollerLifecycle, type LeadPollerFactoryInput, type LeadPollerPort } from "./lead-poller-lifecycle"
import type { TaskRuntimeContext } from "./runtime-context"

type FakePoller = LeadPollerPort & { readonly teamRunId: string; polls: number; shutdowns: number }

function harness() {
  let sessionId: string | undefined = "session-a"
  let state: ReturnType<TaskRuntimeContext["parentState"]> = { kind: "idle" }
  let sessionFile: string | undefined = "/tmp/lead.jsonl"
  let teams = [ownedTeam("run-owned"), ownedTeam("run-foreign", "session-b")]
  const created: Array<{ readonly input: LeadPollerFactoryInput; readonly poller: FakePoller }> = []
  const mapReads: string[] = []
  const intervals: Array<{ readonly tick: () => void; readonly ms: number }> = []
  let intervalDisposals = 0
  const injected: IdleInjection[] = []
  let scheduled = 0
  let soon = 0
  const userMessages: string[] = []

  const lifecycle = createLeadPollerLifecycle({
    listTeams: async () => teams,
    runtime: {
      sessionId: () => sessionId,
      sessionFile: () => sessionFile,
      parentState: () => state,
    },
    config: toTeamCoreConfig(OmoTaskSettingsSchema.parse({}), "/tmp/teams"),
    runtimeDir: (teamRunId) => `/tmp/runtime/${teamRunId}`,
    waitRegistry: new WaitRegistry<Message>(),
    appendTaskEvent: () => undefined,
    pi: { sendUserMessage: (content) => userMessages.push(String(content)) },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    coordinator: {
      enqueue: (injection) => injected.push(injection),
      scheduleFlush: () => { scheduled += 1 },
      flushSoon: () => { soon += 1 },
    },
    createPoller: (input) => {
      const poller: FakePoller = {
        teamRunId: input.teamRunId,
        polls: 0,
        shutdowns: 0,
        pollOnce: async () => { poller.polls += 1 },
        shutdown: () => { poller.shutdowns += 1 },
      }
      created.push({ input, poller })
      return poller
    },
    readMemberTaskMap: async (runtimeDir) => {
      mapReads.push(runtimeDir)
      return { alpha: "st_alpha" }
    },
    scheduleInterval: (tick, ms) => {
      intervals.push({ tick, ms })
      return () => { intervalDisposals += 1 }
    },
  })

  return {
    lifecycle,
    created,
    mapReads,
    intervals,
    injected,
    userMessages,
    get scheduled() { return scheduled },
    get soon() { return soon },
    get intervalDisposals() { return intervalDisposals },
    setSessionId: (value: string | undefined) => { sessionId = value },
    setState: (value: ReturnType<TaskRuntimeContext["parentState"]>) => { state = value },
    setSessionFile: (value: string | undefined) => { sessionFile = value },
    setTeams: (value: typeof teams) => { teams = value },
  }
}

function ownedTeam(teamRunId: string, leadSessionId = "session-a") {
  return { teamRunId, teamName: teamRunId, status: "active", memberCount: 1, scope: "project" as const, leadSessionId }
}

describe("lead poller lifecycle", () => {
  test("#given owned and foreign teams #when ticks repeat #then only one owned poller is created and reused", async () => {
    // given
    const h = harness()

    // when
    await h.lifecycle.tick()
    await h.lifecycle.tick()

    // then
    expect(h.created.map((entry) => entry.poller.teamRunId)).toEqual(["run-owned"])
    expect(h.created[0]?.poller.polls).toBe(2)
    expect(h.mapReads).toEqual(["/tmp/runtime/run-owned"])
    expect(h.created[0]?.input.eventTaskId(messageFrom("alpha"))).toBe("st_alpha")
  })

  test("#given an owned lead without a captured session file #when the lifecycle ticks #then it does not reserve inbox delivery until persistence is possible", async () => {
    // given
    const h = harness()
    h.setSessionFile(undefined)

    // when
    await h.lifecycle.tick()

    // then
    expect(h.created).toHaveLength(0)

    // when the session file is captured
    h.setSessionFile("/tmp/lead.jsonl")
    await h.lifecycle.tick()

    // then
    expect(h.created[0]?.poller.polls).toBe(1)
  })

  test("#given a lead without a captured session file #when team_wait resolves its owned run #then no poller is available to reserve delivery", async () => {
    // given
    const h = harness()
    h.setSessionFile(undefined)

    // when
    const resolved = await h.lifecycle.resolveTeamRunId()
    const poller = h.lifecycle.resolveLeadPoller("run-owned")

    // then
    expect(resolved).toEqual({ ok: true, teamRunId: "run-owned" })
    expect(h.created).toHaveLength(0)
    expect(poller).toBeUndefined()
  })

  test("#given a compacting parent #when the lifecycle ticks #then the owned poller is suspended", async () => {
    // given
    const h = harness()
    await h.lifecycle.tick()
    h.setState({ kind: "compacting" })

    // when
    await h.lifecycle.tick()

    // then
    expect(h.created[0]?.poller.polls).toBe(1)
  })

  test("#given ownership disappears #when the lifecycle reconciles #then the old poller shuts down and cannot resolve", async () => {
    // given
    const h = harness()
    await h.lifecycle.tick()
    h.setTeams([ownedTeam("run-owned", "session-b")])

    // when
    await h.lifecycle.tick()

    // then
    expect(h.created[0]?.poller.shutdowns).toBe(1)
    expect(h.lifecycle.resolveLeadPoller("run-owned")).toBeUndefined()
  })

  test("#given multiple owned teams #when no run id is resolved #then an explicit id is required", async () => {
    // given
    const h = harness()
    h.setTeams([ownedTeam("run-a"), ownedTeam("run-b")])

    // when
    const missing = await h.lifecycle.resolveTeamRunId()
    const explicit = await h.lifecycle.resolveTeamRunId("run-b")

    // then
    expect(missing).toMatchObject({ ok: false })
    expect(explicit).toEqual({ ok: true, teamRunId: "run-b" })
  })

  test("#given coordinator delivery states #when an injection enqueues #then scheduling follows streaming idle and transition rules", async () => {
    // given
    const h = harness()
    await h.lifecycle.tick()
    const sink = h.created[0]?.input.coordinator
    if (sink === undefined) throw new Error("expected sink")

    // when
    h.setState({ kind: "streaming" })
    sink.enqueue(injection("stream"))
    h.setState({ kind: "idle" })
    sink.enqueue(injection("idle"))
    h.setState({ kind: "session_switching" })
    sink.enqueue(injection("transition"))

    // then
    expect(h.injected.map((entry) => entry.key)).toEqual(["stream", "idle", "transition"])
    expect(h.scheduled).toBe(1)
    expect(h.soon).toBe(1)
  })

  test("#given the component shuts down #when disposed #then the interval and every poller stop", async () => {
    // given
    const h = harness()
    await h.lifecycle.tick()
    expect(h.intervals.map((entry) => entry.ms)).toEqual([1000])

    // when
    h.lifecycle.shutdown()

    // then
    expect(h.intervalDisposals).toBe(1)
    expect(h.created[0]?.poller.shutdowns).toBe(1)
  })
})

function messageFrom(from: string): Message {
  return { version: 1, messageId: "11111111-1111-4111-8111-111111111111", from, to: "lead", kind: "message", body: "done", timestamp: 1 }
}

function injection(key: string): LeadInjection {
  return { key, source: "team-message", content: key }
}
