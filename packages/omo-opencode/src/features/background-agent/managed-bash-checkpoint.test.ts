import { describe, expect, test } from "bun:test"
import {
  ManagedBashCheckpointObserver,
  formatManagedBashCheckpointNotification,
  parseManagedBashCheckpoint,
} from "./managed-bash-checkpoint"

const CHECKPOINT = {
  schema_version: 1,
  event: "wait_checkpoint",
  job_id: "job-1",
  status: "running",
  captured_bytes: 8_192,
  start_cursor_bytes: 4_096,
  next_cursor_bytes: 8_192,
  finished_at_unix_ms: 1_785_081_600_000,
} as const

const SCOPE = {
  taskID: "bg_task_1",
  attemptID: "att_1",
} as const

describe("managed-bash checkpoint parsing", () => {
  test("#given a closed v1 running checkpoint #when parsed #then its bounded fields are retained", () => {
    // given / when
    const checkpoint = parseManagedBashCheckpoint(CHECKPOINT)

    // then
    expect(checkpoint).toEqual(CHECKPOINT)
  })

  test.each([
    ["unknown schema", { ...CHECKPOINT, schema_version: 2 }],
    ["unknown event", { ...CHECKPOINT, event: "job_progress" }],
    ["unknown status", { ...CHECKPOINT, status: "paused" }],
    ["unknown field", { ...CHECKPOINT, output: "secret log text" }],
    ["invalid cursor order", { ...CHECKPOINT, next_cursor_bytes: 9_000 }],
    ["invalid job id", { ...CHECKPOINT, job_id: "job id" }],
  ])("#given %s payload #when parsed #then it is rejected", (_name, payload) => {
    // given / when / then
    expect(parseManagedBashCheckpoint(payload)).toBeUndefined()
  })

  test.each([
    "running",
    "succeeded",
    "nonzero_exit",
    "signal_exit",
    "cancelled",
    "hard_timeout",
    "output_limit",
    "runner_lost",
  ] as const)("#given producer status %s #when parsed and formatted #then the actual status is retained", (status) => {
    // given
    const payload = { ...CHECKPOINT, status }

    // when
    const checkpoint = parseManagedBashCheckpoint(payload)
    const notification = checkpoint && formatManagedBashCheckpointNotification(checkpoint, SCOPE.taskID)

    // then
    expect(checkpoint?.status).toBe(status)
    expect(notification).toContain(`**Status:** ${status}`)
  })

  test("#given every bounded field is at its schema maximum #when parsed #then the valid payload remains within 512 bytes", () => {
    // given
    const payload = {
      ...CHECKPOINT,
      job_id: "j".repeat(64),
      captured_bytes: 104_857_600,
      start_cursor_bytes: 104_857_600,
      next_cursor_bytes: 104_857_600,
      finished_at_unix_ms: Number.MAX_SAFE_INTEGER,
    }

    // when / then
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(512)
    expect(parseManagedBashCheckpoint(payload)).toEqual(payload)
  })
})

describe("ManagedBashCheckpointObserver", () => {
  test("#given a current-attempt managed_bash wait call #when success carries a checkpoint #then it is correlated and accepted", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    observer.observeCalled({
      sessionID: "ses-child",
      callID: "call-1",
      tool: "managed_bash",
      input: { action: "wait", job_id: "job-1" },
    }, SCOPE)

    // when
    const observation = observer.observeSuccess({
      sessionID: "ses-child",
      callID: "call-1",
      structured: { managed_bash_checkpoint: CHECKPOINT },
    }, SCOPE)

    // then
    expect(observation?.checkpoint).toEqual(CHECKPOINT)
    expect(observation?.latestOnlyKey).toBe("managed-bash:bg_task_1:att_1:job-1")
  })

  test("#given a persisted completed managed_bash wait part #when observed without a success event #then it is accepted as fallback", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()

    // when
    const observation = observer.observeCompletedPart({
      sessionID: "ses-child",
      part: {
        type: "tool",
        callID: "call-1",
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait", job_id: "job-1" },
          metadata: { managed_bash_checkpoint: CHECKPOINT },
        },
      },
    }, SCOPE)

    // then
    expect(observation?.checkpoint.job_id).toBe("job-1")
  })

  test("#given success and completed-part forms contain the same checkpoint #when both are observed #then the fallback is deduplicated", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    observer.observeCalled({
      sessionID: "ses-child",
      callID: "call-1",
      tool: "managed_bash",
      input: { action: "wait" },
    }, SCOPE)
    const success = observer.observeSuccess({
      sessionID: "ses-child",
      callID: "call-1",
      structured: { managed_bash_checkpoint: CHECKPOINT },
    }, SCOPE)

    // when
    const fallback = observer.observeCompletedPart({
      sessionID: "ses-child",
      part: {
        type: "tool",
        callID: "call-1",
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait" },
          metadata: { managed_bash_checkpoint: CHECKPOINT },
        },
      },
    }, SCOPE)

    // then
    expect(success).toBeDefined()
    expect(fallback).toBeUndefined()
  })

  test("#given a newer checkpoint was accepted #when a delayed completed-part fallback carries older cursors #then it cannot replace current progress", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    const newerCheckpoint = {
      ...CHECKPOINT,
      captured_bytes: 12_288,
      start_cursor_bytes: 8_192,
      next_cursor_bytes: 12_288,
    }
    observer.observeCalled({
      sessionID: "ses-child",
      callID: "call-new",
      tool: "managed_bash",
      input: { action: "wait" },
    }, SCOPE)
    const current = observer.observeSuccess({
      sessionID: "ses-child",
      callID: "call-new",
      structured: { managed_bash_checkpoint: newerCheckpoint },
    }, SCOPE)

    // when
    const delayedFallback = observer.observeCompletedPart({
      sessionID: "ses-child",
      part: {
        type: "tool",
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait" },
          metadata: { managed_bash_checkpoint: CHECKPOINT },
        },
      },
    }, SCOPE)

    // then
    expect(current?.checkpoint).toEqual(newerCheckpoint)
    expect(delayedFallback).toBeUndefined()
  })

  test.each([
    ["wrong tool", "bash", { action: "wait" }],
    ["wrong action", "managed_bash", { action: "status" }],
  ])("#given a %s call #when success carries checkpoint-shaped metadata #then it is ignored", (_name, tool, input) => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    observer.observeCalled({ sessionID: "ses-child", callID: "call-1", tool, input }, SCOPE)

    // when
    const observation = observer.observeSuccess({
      sessionID: "ses-child",
      callID: "call-1",
      structured: { managed_bash_checkpoint: CHECKPOINT },
    }, SCOPE)

    // then
    expect(observation).toBeUndefined()
  })

  test("#given a call belongs to an earlier attempt #when its success arrives under the current scope #then it is ignored", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    observer.observeCalled({
      sessionID: "ses-old",
      callID: "call-1",
      tool: "managed_bash",
      input: { action: "wait" },
    }, { taskID: SCOPE.taskID, attemptID: "att_old" })

    // when
    const observation = observer.observeSuccess({
      sessionID: "ses-old",
      callID: "call-1",
      structured: { managed_bash_checkpoint: CHECKPOINT },
    }, SCOPE)

    // then
    expect(observation).toBeUndefined()
  })

  test("#given an accepted attempt has checkpoint replacement keys #when the attempt is purged for retry #then all stale keys are returned once", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    const part = (jobID: string, callID: string) => ({
      sessionID: "ses-child",
      part: {
        type: "tool",
        callID,
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait" },
          metadata: { managed_bash_checkpoint: { ...CHECKPOINT, job_id: jobID } },
        },
      },
    })
    observer.observeCompletedPart(part("job-1", "call-1"), SCOPE)
    observer.observeCompletedPart(part("job-2", "call-2"), SCOPE)

    // when
    const removedKeys = observer.purgeAttempt(SCOPE)

    // then
    expect(removedKeys).toEqual([
      "managed-bash:bg_task_1:att_1:job-1",
      "managed-bash:bg_task_1:att_1:job-2",
    ])
    expect(observer.purgeAttempt(SCOPE)).toEqual([])
  })

  test("#given observer correlation and checkpoint state #when cleared for shutdown #then no attempt state remains", () => {
    // given
    const observer = new ManagedBashCheckpointObserver()
    observer.observeCompletedPart({
      part: {
        type: "tool",
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait" },
          metadata: { managed_bash_checkpoint: CHECKPOINT },
        },
      },
    }, SCOPE)
    observer.observeCalled({ sessionID: "ses-child", callID: "pending-call", tool: "managed_bash", input: { action: "wait" } }, SCOPE)

    // when
    observer.clear()

    // then
    expect(observer.purgeAttempt(SCOPE)).toEqual([])
    expect(observer.observeSuccess({ sessionID: "ses-child", callID: "pending-call", structured: { managed_bash_checkpoint: CHECKPOINT } }, SCOPE)).toBeUndefined()
  })
})

test("#given the largest valid checkpoint #when its parent notification is formatted #then it is log-free and at most 1 KiB", () => {
  // given
  const checkpoint = {
    ...CHECKPOINT,
    job_id: "j".repeat(64),
    captured_bytes: 104_857_600,
    start_cursor_bytes: 104_857_599,
    next_cursor_bytes: 104_857_600,
    finished_at_unix_ms: Number.MAX_SAFE_INTEGER,
  }

  // when
  const notification = formatManagedBashCheckpointNotification(checkpoint, "t".repeat(256))

  // then
  expect(Buffer.byteLength(notification, "utf8")).toBeLessThanOrEqual(1_024)
  expect(notification).toContain("[MANAGED BASH CHECKPOINT]")
  expect(notification).toContain("104857600")
  expect(notification).not.toContain("output")
  expect(notification).not.toContain("command")
})
