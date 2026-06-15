import { describe, expect, it } from "bun:test"
import type { BackgroundTask } from "../types"
import {
  type PersistedTaskSnapshot,
  parseSnapshotFile,
  snapshotToTask,
  taskToSnapshot,
} from "./snapshot-schema"

const OWNER = { pid: 4242, startedAt: "2026-06-12T10:00:00.000Z" }

function buildTask(): BackgroundTask {
  return {
    id: "task-abc",
    sessionId: "ses_child",
    rootSessionId: "ses_root",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    teamRunId: "team-run-1",
    description: "do a thing",
    prompt: "SECRET-LAUNCH-PROMPT-should-never-touch-disk",
    agent: "sisyphus-junior",
    spawnDepth: 2,
    status: "running",
    queuedAt: new Date("2026-06-12T09:58:00.000Z"),
    startedAt: new Date("2026-06-12T09:59:00.000Z"),
    completedAt: new Date("2026-06-12T10:01:00.000Z"),
    error: "boom",
    concurrencyKey: "anthropic/claude-opus-4-8",
    concurrencyGroup: "anthropic/claude-opus-4-8",
    category: "unspecified-high",
    model: {
      providerID: "anthropic",
      modelID: "claude-opus-4-8",
      variant: "thinking",
      reasoningEffort: "high",
    },
  }
}

describe("taskToSnapshot", () => {
  it("maps all persisted fields and converts Dates to ISO strings", () => {
    // #given a fully populated background task
    const task = buildTask()

    // #when converting it to a snapshot
    const snapshot = taskToSnapshot(task, OWNER)

    // #then scalar identity fields are carried over
    expect(snapshot.schema_version).toBe(1)
    expect(snapshot.id).toBe("task-abc")
    expect(snapshot.sessionId).toBe("ses_child")
    expect(snapshot.rootSessionId).toBe("ses_root")
    expect(snapshot.parentSessionId).toBe("ses_parent")
    expect(snapshot.parentMessageId).toBe("msg_parent")
    expect(snapshot.teamRunId).toBe("team-run-1")
    expect(snapshot.description).toBe("do a thing")
    expect(snapshot.agent).toBe("sisyphus-junior")
    expect(snapshot.spawnDepth).toBe(2)
    expect(snapshot.status).toBe("running")
    expect(snapshot.error).toBe("boom")
    expect(snapshot.concurrencyKey).toBe("anthropic/claude-opus-4-8")
    expect(snapshot.concurrencyGroup).toBe("anthropic/claude-opus-4-8")
    expect(snapshot.category).toBe("unspecified-high")

    // #then dates are serialized as ISO strings
    expect(snapshot.queuedAt).toBe("2026-06-12T09:58:00.000Z")
    expect(snapshot.startedAt).toBe("2026-06-12T09:59:00.000Z")
    expect(snapshot.completedAt).toBe("2026-06-12T10:01:00.000Z")
    expect(typeof snapshot.updatedAt).toBe("string")
    expect(Number.isNaN(Date.parse(snapshot.updatedAt))).toBe(false)

    // #then only the model subset is persisted
    expect(snapshot.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-8",
      variant: "thinking",
    })

    // #then owner identity is captured
    expect(snapshot.owner).toEqual(OWNER)
  })

  it("omits optional fields that are absent on the task", () => {
    // #given a minimal task
    const task: BackgroundTask = {
      id: "task-min",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      description: "minimal",
      prompt: "another secret",
      agent: "sisyphus-junior",
      status: "pending",
    }

    // #when converting it
    const snapshot = taskToSnapshot(task, OWNER)

    // #then optional fields are undefined, not present
    expect(snapshot.sessionId).toBeUndefined()
    expect(snapshot.model).toBeUndefined()
    expect(snapshot.queuedAt).toBeUndefined()
    expect(snapshot.startedAt).toBeUndefined()
    expect(snapshot.completedAt).toBeUndefined()
    expect(snapshot.category).toBeUndefined()
  })
})

describe("snapshot serialization", () => {
  it("never writes the launch prompt to disk", () => {
    // #given a task with a sensitive prompt
    const task = buildTask()

    // #when serializing the snapshot to JSON
    const json = JSON.stringify(taskToSnapshot(task, OWNER))

    // #then the prompt text is absent from the serialized payload
    expect(json).not.toContain("SECRET-LAUNCH-PROMPT-should-never-touch-disk")
    expect(json).not.toContain("prompt")
  })
})

describe("roundtrip taskToSnapshot -> snapshotToTask", () => {
  it("preserves all listed fields and reconstructs Dates", () => {
    // #given a task converted to a snapshot
    const task = buildTask()
    const snapshot = taskToSnapshot(task, OWNER)

    // #when reconstructing the task from the snapshot
    const restored = snapshotToTask(snapshot)

    // #then identity and scalar fields match
    expect(restored.id).toBe(task.id)
    expect(restored.sessionId).toBe(task.sessionId)
    expect(restored.rootSessionId).toBe(task.rootSessionId)
    expect(restored.parentSessionId).toBe(task.parentSessionId)
    expect(restored.parentMessageId).toBe(task.parentMessageId)
    expect(restored.teamRunId).toBe(task.teamRunId)
    expect(restored.description).toBe(task.description)
    expect(restored.agent).toBe(task.agent)
    expect(restored.spawnDepth).toBe(task.spawnDepth)
    expect(restored.status).toBe(task.status)
    expect(restored.error).toBe(task.error)
    expect(restored.concurrencyKey).toBe(task.concurrencyKey)
    expect(restored.concurrencyGroup).toBe(task.concurrencyGroup)
    expect(restored.category).toBe(task.category)

    // #then dates are reconstructed as Date instances with identical values
    expect(restored.queuedAt).toBeInstanceOf(Date)
    expect(restored.queuedAt?.toISOString()).toBe("2026-06-12T09:58:00.000Z")
    expect(restored.startedAt?.toISOString()).toBe("2026-06-12T09:59:00.000Z")
    expect(restored.completedAt?.toISOString()).toBe("2026-06-12T10:01:00.000Z")

    // #then model subset is restored
    expect(restored.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-8",
      variant: "thinking",
    })
  })

  it("sets prompt to the placeholder since it is not persisted", () => {
    // #given a roundtripped task
    const restored = snapshotToTask(taskToSnapshot(buildTask(), OWNER))

    // #then the prompt is the explicit placeholder
    expect(restored.prompt).toBe("[not persisted across restart]")
  })

  it("falls back to empty strings for required parent fields when absent", () => {
    // #given a snapshot with no parent identifiers
    const snapshot: PersistedTaskSnapshot = {
      schema_version: 1,
      id: "task-noparent",
      description: "orphan",
      agent: "sisyphus-junior",
      status: "pending",
      owner: OWNER,
      updatedAt: "2026-06-12T10:00:00.000Z",
    }

    // #when reconstructing the task
    const restored = snapshotToTask(snapshot)

    // #then required string fields are present and empty
    expect(restored.parentSessionId).toBe("")
    expect(restored.parentMessageId).toBe("")
  })
})

describe("parseSnapshotFile", () => {
  it("parses a valid serialized snapshot", () => {
    // #given a serialized valid snapshot
    const content = JSON.stringify(taskToSnapshot(buildTask(), OWNER))

    // #when parsing it
    const parsed = parseSnapshotFile(content)

    // #then it returns the snapshot
    expect(parsed?.id).toBe("task-abc")
    expect(parsed?.schema_version).toBe(1)
    expect(parsed?.owner.pid).toBe(4242)
  })

  it("returns undefined on garbage JSON", () => {
    // #given non-JSON content
    // #when parsing it
    // #then it returns undefined without throwing
    expect(parseSnapshotFile("{not valid json")).toBeUndefined()
    expect(parseSnapshotFile("")).toBeUndefined()
  })

  it("returns undefined on a wrong schema version", () => {
    // #given a snapshot with the wrong schema version
    const content = JSON.stringify({
      schema_version: 2,
      id: "task-abc",
      description: "x",
      agent: "a",
      status: "pending",
      owner: OWNER,
      updatedAt: "2026-06-12T10:00:00.000Z",
    })

    // #when parsing it
    // #then it returns undefined
    expect(parseSnapshotFile(content)).toBeUndefined()
  })

  it("returns undefined when id is missing or not a string", () => {
    // #given snapshots with a bad id
    const missingId = JSON.stringify({
      schema_version: 1,
      description: "x",
      agent: "a",
      status: "pending",
      owner: OWNER,
      updatedAt: "2026-06-12T10:00:00.000Z",
    })
    const numericId = JSON.stringify({
      schema_version: 1,
      id: 123,
      description: "x",
      agent: "a",
      status: "pending",
      owner: OWNER,
      updatedAt: "2026-06-12T10:00:00.000Z",
    })

    // #when parsing them
    // #then both return undefined
    expect(parseSnapshotFile(missingId)).toBeUndefined()
    expect(parseSnapshotFile(numericId)).toBeUndefined()
  })

  it("returns undefined when owner is missing", () => {
    // #given a snapshot without an owner
    const content = JSON.stringify({
      schema_version: 1,
      id: "task-abc",
      description: "x",
      agent: "a",
      status: "pending",
      updatedAt: "2026-06-12T10:00:00.000Z",
    })

    // #when parsing it
    // #then it returns undefined
    expect(parseSnapshotFile(content)).toBeUndefined()
  })
})
