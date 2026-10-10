import { appendFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { isHostSessionHandle } from "../runners/rpc-host"
import type { FakeHost } from "../runners/rpc-host/__fixtures__/fake-host"
import { childSpec, hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, type HostSessionIdentity, type TaskRecord } from "../state"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

type HostRespawnCalls = {
  readonly specs: RpcRunnerSpec[]
  readonly switched: string[]
  readonly followUps: string[]
}

// A JSONL tail whose last entry is an unanswered user message: `sessionTailNeedsContinuation` says
// the turn was interrupted, so a NON-attached resume must nudge and an attached one must not. It
// lives inside the test project so `cleanupProjects` tears it down with everything else.
function interruptedTranscript(project: string): string {
  const path = join(project, "session.jsonl")
  writeFileSync(path, `${JSON.stringify({ type: "message", message: { role: "user", content: "keep going" } })}\n`)
  return path
}

// The transcript a finished turn leaves: its last entry is the assistant's final answer.
function completedTranscript(project: string): string {
  const path = join(project, "completed.jsonl")
  const entries = [
    { type: "message", message: { role: "user", content: "do it" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } },
  ]
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
  return path
}

// Extension bookkeeping a live senpi session appends after its last message - the hooks' stop state
// when a turn stops, and the rules scan / memory binding a host writes when it reopens the session.
// None of them is part of the conversation.
const BOOKKEEPING_ROWS = [
  { type: "custom", customType: "senpi.hooks.stop-state", data: {} },
  { type: "custom", customType: "pi-rules.scan", data: {} },
  { type: "custom", customType: "senpi-memory.session-binding", data: {} },
]

function transcriptOf(project: string, name: string, entries: readonly unknown[], trailer = ""): string {
  const path = join(project, name)
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n${trailer}`)
  return path
}

const TOOL_TURN_IN_FLIGHT = [
  { type: "message", message: { role: "user", content: "do the work" } },
  { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "eval", arguments: {} }], stopReason: "toolUse" } },
  { type: "message", message: { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "partial" }] } },
]

const TURN_ANSWERED = [
  { type: "message", message: { role: "user", content: "do the work" } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } },
]

function hostRunner(
  calls: HostRespawnCalls,
  openDisposition: "attached" | "reopened",
  onFollowUp?: (text: string) => void,
) {
  return {
    start: (spec: RpcRunnerSpec): Promise<RpcChildHandle> => {
      calls.specs.push(spec)
      const handle = {
        ...makeHandle(spec.task_id).handle,
        kind: "host-session" as const,
        attached: true,
        openDisposition,
        pid: undefined,
        subscribe: () => () => undefined,
        waitForIdle: () => Promise.resolve(),
        terminate: () => Promise.resolve(),
        exitOutcome: () => undefined,
        waitForExit: () =>
          Promise.resolve({ kind: "clean" as const, facts: { pid: undefined, code: 0, signal: null, stderrTail: "" } }),
        lastSeen: () => undefined,
        followUp: (text: string) => {
          calls.followUps.push(text)
          onFollowUp?.(text)
          return Promise.resolve()
        },
        switchSession: (path: string) => {
          calls.switched.push(path)
          return Promise.resolve({ cancelled: false })
        },
      }
      return Promise.resolve(handle)
    },
  }
}

function hostRecord(project: string, identity: HostSessionIdentity, model = "fake-model"): TaskRecord {
  return {
    ...createTaskRecord(
      {
        parent_session_id: "parent-host",
        root_session_id: "parent-host",
        depth: 1,
        execution_mode: "process",
        model,
        notify_on_terminal: false,
      },
      Date.parse("2026-09-17T00:00:00.000Z"),
    ),
    status: "running",
    spawn_spec: { version: 1, cwd: project, prompt: "host child" },
    runner_kind: "host-session",
    host_session: identity,
  }
}

describe("respawn of a daemon-hosted child", () => {
  test("#given a live session the daemon still holds #when respawn attaches #then neither switch_session nor a continuation nudge is sent", async () => {
    // given
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-1",
      session_path: "/tmp/dh-fake/sessions/child.jsonl",
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }
    const record = hostRecord(project, identity)

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record,
      sessionPath: transcript,
      stateDir: project,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: hostRunner(calls, "attached"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.switched).toEqual([])
    expect(calls.followUps).toEqual([])
    expect(calls.specs.map((spec) => spec.resumeSessionPath)).toEqual([identity.session_path])
  })

  test("#given a session the daemon evicted #when respawn reopens it from JSONL #then the interrupted turn is nudged exactly once", async () => {
    // given
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-2",
      session_path: transcript,
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: transcript,
      stateDir: project,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.specs.map((spec) => spec.resumeSessionPath)).toEqual([transcript])
    expect(calls.followUps).toHaveLength(1)
  })

  test("#given a recorded session directory that is gone from disk #when the host reopens rather than re-joins it #then the child fails by itself naming the missing transcript and nothing is resumed", async () => {
    // given
    const project = tempProject()
    const missing = join(project, "deleted", "child.jsonl")
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-missing",
      session_path: missing,
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: missing,
      stateDir: project,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result).toMatchObject({ ok: false, disposition: "unrecoverable", code: "session_unavailable" })
    expect(result.ok ? "" : result.reason).toContain(`recorded session transcript is missing: ${join(project, "deleted")}`)
    expect(calls.switched).toEqual([])
    expect(calls.followUps).toEqual([])
  })

  test("#given a reopened session whose first continuation is still unanswered #when the same record respawns again #then only one continuation is sent in total", async () => {
    // given
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-repeat-before-answer",
      session_path: transcript,
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }
    const runner = hostRunner(calls, "reopened", (text) => {
      appendFileSync(transcript, `${JSON.stringify({ type: "message", message: { role: "user", content: text } })}\n`)
    })
    const input = {
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: runner,
    }

    // when
    const first = await respawnManagedTask(input)
    const second = await respawnManagedTask(input)

    // then
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls.followUps).toHaveLength(1)
  })

  test("#given a reopened session whose first continuation was aborted by another host stop #when the same record respawns again #then only one continuation is sent in total", async () => {
    // given - a forced host stop can append an aborted assistant row after our continuation prompt
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-repeat-after-abort",
      session_path: transcript,
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }
    const runner = hostRunner(calls, "reopened", (text) => {
      const entries = [
        { type: "message", message: { role: "user", content: text } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "aborted" } },
        { type: "custom", customType: "senpi.hooks.stop-state", data: {} },
      ]
      appendFileSync(transcript, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
    })
    const input = {
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: runner,
    }

    // when
    const first = await respawnManagedTask(input)
    const second = await respawnManagedTask(input)

    // then
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls.followUps).toHaveLength(1)
  })

  test("#given a reopened session whose first continuation was answered #when the same record respawns again #then only one continuation is sent in total", async () => {
    // given
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-repeat-after-answer",
      session_path: transcript,
      instance_id: "instance-1",
    }
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }
    const runner = hostRunner(calls, "reopened", (text) => {
      const entries = [
        { type: "message", message: { role: "user", content: text } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "finished" }], stopReason: "stop" } },
      ]
      appendFileSync(transcript, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
    })
    const input = {
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: runner,
    }

    // when
    const first = await respawnManagedTask(input)
    const second = await respawnManagedTask(input)

    // then
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls.followUps).toHaveLength(1)
  })

  test("#given a real host that no longer holds the session #when respawn reopens it from an interrupted JSONL #then the handle reports reopened and exactly one continuation reaches the host", async () => {
    // given - the host answers open_session with attached:false (reopened from the transcript)
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const host = await harness.fakeHost()
    const started = recordingRunner(host)

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: started,
    })

    // then
    expect(result.ok).toBe(true)
    expect(prompts(host)).toEqual([{ streamingBehavior: "followUp" }])
    const [handle] = started.handles
    expect(handle !== undefined && isHostSessionHandle(handle) ? handle.openDisposition : undefined).toBe("reopened")
    expect(host.commands.filter((command) => command.type === "switch_session")).toHaveLength(0)
  })

  test("#given a real host that still holds the live session #when respawn re-joins it #then the handle reports attached and no continuation is sent", async () => {
    // given - a retained session the host still holds, whose transcript tail looks interrupted
    const project = tempProject()
    const host = await harness.fakeHost()
    const runner = recordingRunner(host)
    const first = await runner.start(childSpec({ state_dir: project }))
    const sessionPath = host.sessions()[0]?.sessionPath ?? ""
    writeFileSync(sessionPath, `${JSON.stringify({ type: "message", message: { role: "user", content: "keep going" } })}\n`)
    await first.dispose()

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, sessionPath), REAL_MODEL),
      sessionPath,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: runner,
    })

    // then - the only prompt is the fresh child's first one
    expect(result.ok).toBe(true)
    const resumed = runner.handles[1]
    expect(resumed !== undefined && isHostSessionHandle(resumed) ? resumed.openDisposition : undefined).toBe("attached")
    expect(prompts(host)).toEqual([{ streamingBehavior: "steer" }])
  })

  test("#given a real host that reopens a session whose turn completed #when respawn resumes it #then the tail rule still sends no continuation", async () => {
    // given
    const project = tempProject()
    const transcript = completedTranscript(project)
    const host = await harness.fakeHost()
    const started = recordingRunner(host)

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: started,
    })

    // then
    expect(result.ok).toBe(true)
    const [handle] = started.handles
    expect(handle !== undefined && isHostSessionHandle(handle) ? handle.openDisposition : undefined).toBe("reopened")
    expect(prompts(host)).toEqual([])
  })

  test("#given a turn that finished while no parent was attached #when respawn reopens the session #then the child's outcome is that final answer, not a wait for an agent_end that already happened (omo#9069)", async () => {
    // given
    const project = tempProject()
    const transcript = completedTranscript(project)
    const host = await harness.fakeHost()

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: recordingRunner(host),
    })

    // then
    if (!result.ok) throw new Error("respawn failed")
    const settled = await Promise.race([result.handle.waitForOutcome(), Bun.sleep(2_000).then(() => "unsettled" as const)])
    expect(settled).toEqual({ status: "completed", finalResponse: "done" })
    expect(prompts(host)).toEqual([])
  })

  test("#given an interrupted turn followed by extension bookkeeping rows #when the host reopens the session #then exactly one continuation reaches the host", async () => {
    // given - the shape a killed host leaves: the tool result is the last MESSAGE, custom rows follow
    const project = tempProject()
    const transcript = transcriptOf(project, "bookkept.jsonl", [...TOOL_TURN_IN_FLIGHT, ...BOOKKEEPING_ROWS])
    const host = await harness.fakeHost()

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: recordingRunner(host),
    })

    // then
    expect(result.ok).toBe(true)
    expect(prompts(host)).toEqual([{ streamingBehavior: "followUp" }])
  })

  test("#given an interrupted tool result whose turn contains an older custom_message #when the host reopens the session #then exactly one continuation reaches the host", async () => {
    // given - the live first-turn transcript writes this context row before the tool call/result
    const project = tempProject()
    const transcript = transcriptOf(project, "in-turn-custom-message.jsonl", [
      { type: "message", message: { role: "user", content: "do the work" } },
      { type: "custom_message", customType: "senpi.todo-first-turn", content: "todo context", display: false },
      ...TOOL_TURN_IN_FLIGHT.slice(1),
      ...BOOKKEEPING_ROWS,
    ])
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, {
        socket: "/tmp/dh-fake/rpc.sock",
        routing_id: "routing-in-turn-custom-message",
        session_path: transcript,
        instance_id: "instance-1",
      }),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.followUps).toHaveLength(1)
  })

  for (const bookkeeping of BOOKKEEPING_ROWS) {
    test(`#given an interrupted turn followed by ${bookkeeping.customType} #when the host reopens the session #then exactly one continuation reaches the host`, async () => {
      // given
      const project = tempProject()
      const transcript = transcriptOf(project, `${bookkeeping.customType}.jsonl`, [...TOOL_TURN_IN_FLIGHT, bookkeeping])
      const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

      // when
      const result = await respawnManagedTask({
        beforeLaunch: () => undefined,
        record: hostRecord(project, {
          socket: "/tmp/dh-fake/rpc.sock",
          routing_id: `routing-${bookkeeping.customType}`,
          session_path: transcript,
          instance_id: "instance-1",
        }),
        sessionPath: transcript,
        stateDir: project,
        runners: unusedManagedRunners(),
        rpcRunner: hostRunner(calls, "reopened"),
      })

      // then
      expect(result.ok).toBe(true)
      expect(calls.followUps).toHaveLength(1)
    })
  }

  test("#given an unanswered prompt followed by an unknown custom row #when the host reopens the session #then no continuation is guessed", async () => {
    // given
    const project = tempProject()
    const transcript = transcriptOf(project, "unknown-custom.jsonl", [
      { type: "message", message: { role: "user", content: "do the work" } },
      { type: "custom", customType: "unknown.extension-state", data: {} },
    ])
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, {
        socket: "/tmp/dh-fake/rpc.sock",
        routing_id: "routing-unknown-custom",
        session_path: transcript,
        instance_id: "instance-1",
      }),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.followUps).toEqual([])
  })

  test("#given an unanswered prompt followed by a custom_message row #when the host reopens the session #then no continuation is guessed", async () => {
    // given
    const project = tempProject()
    const transcript = transcriptOf(project, "custom-message.jsonl", [
      { type: "message", message: { role: "user", content: "do the work" } },
      { type: "custom_message", customType: "environment-context", content: "context", display: false },
    ])
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, {
        socket: "/tmp/dh-fake/rpc.sock",
        routing_id: "routing-custom-message",
        session_path: transcript,
        instance_id: "instance-1",
      }),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.followUps).toEqual([])
  })

  test("#given an answered turn followed by extension bookkeeping rows #when the host reopens the session #then no continuation is sent", async () => {
    // given
    const project = tempProject()
    const transcript = transcriptOf(project, "answered.jsonl", [...TURN_ANSWERED, ...BOOKKEEPING_ROWS])
    const host = await harness.fakeHost()

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: recordingRunner(host),
    })

    // then
    expect(result.ok).toBe(true)
    expect(prompts(host)).toEqual([])
  })

  test("#given an interrupted turn whose final JSONL record is malformed #when the host reopens the session #then no continuation is guessed", async () => {
    // given - a torn final write is never skipped to reinterpret an earlier message
    const project = tempProject()
    const transcript = transcriptOf(project, "torn.jsonl", TOOL_TURN_IN_FLIGHT, '{"type":"custom","customType":')
    const host = await harness.fakeHost()

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, realIdentity(host, transcript), REAL_MODEL),
      sessionPath: transcript,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: recordingRunner(host),
    })

    // then
    expect(result.ok).toBe(true)
    expect(prompts(host)).toEqual([])
  })

  const IN_TURN_ROWS = [
    { type: "custom_message", customType: "unknown.in-turn-note", content: "note", display: false },
    { type: "custom", customType: "unknown.in-turn-state", data: {} },
  ]

  for (const inTurn of IN_TURN_ROWS) {
    test(`#given a continued turn holding a ${inTurn.type} row that was interrupted again #when a restarted host reopens it #then only one continuation is sent in total`, async () => {
      // given - the transcript-writing host persists the first continuation; another row, a tool
      // call and its result follow before the host stops again
      const tool = TOOL_TURN_IN_FLIGHT.slice(1)

      // when
      const total = await continuationsOverTwoReopens([inTurn, ...tool, BOOKKEEPING_ROWS[0]])

      // then
      expect(total).toBe(1)
    })
  }

  test("#given an interrupted turn holding a malformed JSONL record #when the host reopens the session #then no continuation is guessed", async () => {
    // given
    const project = tempProject()
    const [user, ...tool] = TOOL_TURN_IN_FLIGHT
    const path = join(project, "torn-in-turn.jsonl")
    const rows = [user, '{"type":"custom","customType":', ...tool, ...BOOKKEEPING_ROWS]
    writeFileSync(path, `${rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n")}\n`)
    const calls: HostRespawnCalls = { specs: [], switched: [], followUps: [] }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, {
        socket: "/tmp/dh-fake/rpc.sock",
        routing_id: "routing-torn-in-turn",
        session_path: path,
        instance_id: "instance-1",
      }),
      sessionPath: path,
      stateDir: project,
      runners: unusedManagedRunners(),
      rpcRunner: hostRunner(calls, "reopened"),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.followUps).toEqual([])
  })

  test("#given a host that is draining an old generation #when open_session reports session_path_in_use #then respawn defers as host_draining with the advertised delay", async () => {
    // given
    const project = tempProject()
    const identity: HostSessionIdentity = {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-3",
      session_path: "/tmp/dh-fake/sessions/drain.jsonl",
      instance_id: "instance-old",
    }
    const held = Object.assign(new Error("session path in use"), {
      name: "SessionHeldElsewhereError",
      code: "session_path_in_use",
      retryAfterMs: 750,
    })

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: identity.session_path,
      stateDir: project,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: { start: () => Promise.reject(held) },
    })

    // then
    expect(result).toEqual({
      ok: false,
      disposition: "retryable",
      code: "host_draining",
      reason: "session path in use",
      retryAfterMs: 750,
    })
  })
})

const REAL_MODEL = "anthropic/claude-sonnet-4-5"

function realIdentity(host: FakeHost, sessionPath: string): HostSessionIdentity {
  return { socket: host.socketPath, routing_id: "routing-old", session_path: sessionPath, instance_id: "fake-instance" }
}

function unusedManagedRunners() {
  return {
    "in-process": { start: () => Promise.reject(new Error("unused")) },
    process: { start: () => Promise.reject(new Error("unused")) },
  }
}

/** The real `RpcHostRunner` over the fake host, keeping every handle it started. */
function recordingRunner(host: FakeHost) {
  const runner = harness.runnerOver(host)
  const handles: RpcChildHandle[] = []
  return {
    handles,
    start: async (spec: RpcRunnerSpec): Promise<RpcChildHandle> => {
      const handle = await runner.start(spec)
      handles.push(handle)
      return handle
    },
  }
}

/**
 * Reopens an interrupted tool turn on a transcript-writing fake host, lets `afterContinuation`
 * land after the persisted continuation prompt, restarts the host and reopens again; returns every
 * prompt the host received across both reopens.
 */
async function continuationsOverTwoReopens(afterContinuation: readonly unknown[]): Promise<number> {
  const project = tempProject()
  const reopenRows = BOOKKEEPING_ROWS.slice(1)
  const path = transcriptOf(project, "reopened-twice.jsonl", [...TOOL_TURN_IN_FLIGHT, BOOKKEEPING_ROWS[0], ...reopenRows])
  const host = await harness.fakeHost({ transcripts: true })
  const input = {
    beforeLaunch: () => undefined,
    record: hostRecord(project, realIdentity(host, path), REAL_MODEL),
    sessionPath: path,
    stateDir: project,
    runners: unusedManagedRunners(),
    rpcRunner: harness.runnerOver(host),
  }
  const first = await respawnManagedTask(input)
  if (!first.ok) throw new Error("first reopen failed")
  const disconnected = host.waitForConnections(0)
  await first.handle.dispose()
  await disconnected
  await host.restart()
  appendFileSync(path, [...afterContinuation, ...reopenRows].map((row) => `${JSON.stringify(row)}\n`).join(""))
  const second = await respawnManagedTask(input)
  if (second.ok) await second.handle.dispose()
  return host.commands.filter((command) => command.type === "prompt").length
}

/** Each prompt the host received, reduced to its delivery mode - the continuation's wording is never pinned. */
function prompts(host: FakeHost): ReadonlyArray<{ readonly streamingBehavior: unknown }> {
  return host.commands
    .filter((command) => command.type === "prompt")
    .map((command) => ({ streamingBehavior: command.payload.streamingBehavior }))
}
