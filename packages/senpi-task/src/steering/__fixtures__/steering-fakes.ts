import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagedChildHandle } from "../../manager/child-handle"
import { createTaskRecord } from "../../state"
import type { TaskRecord, TaskRecordInput } from "../../state"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { createSteeringEngine } from "../engine"
import type { DestructionCause, DestructionPort, SteeringEngine, SteeringPort } from "../types"

const cleanupRoots: string[] = []

export function cleanupSteering(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-steering-"))
  cleanupRoots.push(directory)
  return directory
}

export type FakeHandle = {
  readonly handle: ManagedChildHandle
  readonly steerCalls: string[]
  readonly followUpCalls: string[]
  readonly abortCalls: number[]
  setLastAssistantText(text: string | undefined): void
}

export type RunnerFlavor = "in-process" | "rpc"

export type FakeHandleOptions = {
  // When set, abort() records the call THEN rejects, mirroring an rpc child that already exited
  // (protocol-client rejects send after isExited). Proves teardown survives an abort rejection.
  readonly abortRejects?: boolean
}

// Both runner adapters normalize onto ManagedChildHandle, so the two flavors differ only in the
// pid/sessionId surface. Steering programs against the unified handle, so this covers both runners.
export function makeFakeHandle(taskId: string, flavor: RunnerFlavor, options: FakeHandleOptions = {}): FakeHandle {
  const steerCalls: string[] = []
  const followUpCalls: string[] = []
  const abortCalls: number[] = []
  let lastText: string | undefined
  const handle: ManagedChildHandle = {
    task_id: taskId,
    sessionId: `sess-${taskId}`,
    pid: flavor === "rpc" ? 4321 : undefined,
    steer: async (text) => {
      steerCalls.push(text)
    },
    followUp: async (text) => {
      followUpCalls.push(text)
    },
    abort: async () => {
      abortCalls.push(abortCalls.length + 1)
      if (options.abortRejects === true) throw new Error("child already exited")
    },
    subscribe: () => () => {},
    waitForOutcome: () => new Promise(() => {}),
    lastAssistantText: () => lastText,
    dispose: async () => {},
  }
  return {
    handle,
    steerCalls,
    followUpCalls,
    abortCalls,
    setLastAssistantText: (text) => {
      lastText = text
    },
  }
}

export type FakeDestruction = DestructionPort & {
  readonly calls: Array<{ readonly taskId: string; readonly cause: DestructionCause }>
}

export function makeFakeDestruction(): FakeDestruction {
  const calls: Array<{ readonly taskId: string; readonly cause: DestructionCause }> = []
  return {
    calls,
    destroyResidentTask: async (taskId, cause) => {
      calls.push({ taskId, cause })
    },
  }
}

export type SteeringHarness = {
  readonly engine: SteeringEngine
  readonly store: TaskRecordStore
  readonly destruction: FakeDestruction
  readonly reviveCalls: string[]
  readonly dequeueCalls: string[]
  setLive(taskId: string, handle: ManagedChildHandle): void
  clearLive(taskId: string): void
  seedRecord(overrides?: Partial<TaskRecordInput>): TaskRecord
  now(): number
}

export function makeHarness(): SteeringHarness {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const live = new Map<string, ManagedChildHandle>()
  const destruction = makeFakeDestruction()
  const reviveCalls: string[] = []
  const dequeueCalls: string[] = []
  let clock = Date.parse("2026-07-06T00:00:00.000Z")
  const port: SteeringPort = {
    store,
    liveHandle: (taskId) => live.get(taskId),
    reacquireForRevive: (taskId) => {
      reviveCalls.push(taskId)
    },
    dequeuePending: (taskId) => {
      dequeueCalls.push(taskId)
      return false
    },
    destruction,
    now: () => clock,
  }
  return {
    engine: createSteeringEngine(port),
    store,
    destruction,
    reviveCalls,
    dequeueCalls,
    setLive: (taskId, handle) => {
      live.set(taskId, handle)
    },
    clearLive: (taskId) => {
      live.delete(taskId)
    },
    seedRecord: (overrides = {}) => {
      const record = createTaskRecord({
        parent_session_id: "parent-1",
        root_session_id: "parent-1",
        depth: 1,
        execution_mode: "in-process",
        model: "anthropic/claude",
        ...overrides,
      })
      store.save(record)
      return record
    },
    now: () => {
      clock += 1
      return clock
    },
  }
}
