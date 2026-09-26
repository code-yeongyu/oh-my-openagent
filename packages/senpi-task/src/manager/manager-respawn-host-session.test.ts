import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, type HostSessionIdentity, type TaskRecord } from "../state"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
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

function hostRunner(calls: HostRespawnCalls, attached: boolean) {
  return {
    start: (spec: RpcRunnerSpec): Promise<RpcChildHandle> => {
      calls.specs.push(spec)
      const base = makeHandle(spec.task_id).handle
      const handle = {
        ...base,
        kind: "host-session" as const,
        attached: true,
        rejoinedLiveSession: attached,
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

function hostRecord(project: string, identity: HostSessionIdentity): TaskRecord {
  return {
    ...createTaskRecord(
      {
        parent_session_id: "parent-host",
        root_session_id: "parent-host",
        depth: 1,
        execution_mode: "process",
        model: "fake-model",
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
      rpcRunner: hostRunner(calls, true),
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
      rpcRunner: hostRunner(calls, false),
    })

    // then
    expect(result.ok).toBe(true)
    expect(calls.specs.map((spec) => spec.resumeSessionPath)).toEqual([transcript])
    expect(calls.followUps).toHaveLength(1)
  })

  test("#given the real daemon runner and a session the daemon no longer holds #when respawn reopens it #then the interrupted turn is continued", async () => {
    // given
    const project = tempProject()
    const transcript = interruptedTranscript(project)
    const host = await harness.fakeHost()
    const identity: HostSessionIdentity = {
      socket: host.socketPath,
      routing_id: "routing-evicted",
      session_path: transcript,
      instance_id: "fake-instance",
    }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record: hostRecord(project, identity),
      sessionPath: transcript,
      stateDir: project,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: harness.runnerOver(host),
    })

    // then
    expect(result.ok).toBe(true)
    expect(host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    if (result.ok) await result.handle.dispose()
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
