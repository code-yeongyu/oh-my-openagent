import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../runners/in-process"
import type { RunnerFailure } from "../runners/in-process/child-handle"
import { cleanupProjects, FakeRunner, makeManager } from "./__fixtures__/manager-fakes"

const PRIVATE_DETAIL = "Timeout waiting for response to open_session. Stderr: api_key=sk-private"

afterEach(cleanupProjects)

function closedRunnerError(
  kind: RunnerFailure["kind"],
  reason: NonNullable<RunnerFailure["reason"]>,
): RunnerError {
  return new RunnerError({ kind, reason, message: PRIVATE_DETAIL, cause: new Error(PRIVATE_DETAIL) })
}

describe("TaskManager host start failures", () => {
  test("#given the shared host times out opening a child session #when start fails #then the result and record name the closed failure class", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = closedRunnerError("session_unavailable", "open_timed_out")
    const { manager, store } = makeManager({ process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(
      "The task host did not finish opening the child session in time (open_timed_out).",
    )
    expect(result.failure_kind).toBe("session_unavailable")
    expect(result.failure_reason).toBe("open_timed_out")
    const record = store.load(result.task_id)
    expect(record?.failure_kind).toBe("session_unavailable")
    expect(record?.failure_reason).toBe("open_timed_out")
    expect(record?.error_message).toBe(result.error_message)
    expect(JSON.stringify({ result, record })).not.toContain(PRIVATE_DETAIL)
  })

  test("#given daemon ensure exhausts its lock wait #when start fails #then the result and record name the closed ensure timeout", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = closedRunnerError("host_unavailable", "ensure_timed_out")
    const { manager, store } = makeManager({ process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(
      "The task host did not become ready before the ensure deadline (ensure_timed_out).",
    )
    expect(result.failure_kind).toBe("host_unavailable")
    expect(result.failure_reason).toBe("ensure_timed_out")
    const record = store.load(result.task_id)
    expect(record?.failure_kind).toBe("host_unavailable")
    expect(record?.failure_reason).toBe("ensure_timed_out")
  })

  test("#given the shard socket candidate is too long #when start fails #then the public result and record retain that reason", async () => {
    const runner = new FakeRunner()
    runner.startError = closedRunnerError("host_unavailable", "shard_socket_too_long")
    const { manager, store } = makeManager({ process: runner })

    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.failure_kind).toBe("host_unavailable")
    expect(result.failure_reason).toBe("shard_socket_too_long")
    expect(result.error_message).toContain("shard_socket_too_long")
    const record = store.load(result.task_id)
    expect(record?.failure_kind).toBe("host_unavailable")
    expect(record?.failure_reason).toBe("shard_socket_too_long")
    const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
    expect(eventLog).toContain('"failure_reason":"shard_socket_too_long"')
  })

  test("#given the alternate shard root is unsafe #when start fails #then the public result and record retain that reason", async () => {
    const runner = new FakeRunner()
    runner.startError = closedRunnerError("host_unavailable", "shard_alt_root_unsafe")
    const { manager, store } = makeManager({ process: runner })

    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.failure_kind).toBe("host_unavailable")
    expect(result.failure_reason).toBe("shard_alt_root_unsafe")
    expect(result.error_message).toContain("shard_alt_root_unsafe")
    const record = store.load(result.task_id)
    expect(record?.failure_kind).toBe("host_unavailable")
    expect(record?.failure_reason).toBe("shard_alt_root_unsafe")
    const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
    expect(eventLog).toContain('"failure_reason":"shard_alt_root_unsafe"')
  })

  test("#given a host refusal with a closed code #when start fails #then the parent-authored sentence includes only that code", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = closedRunnerError("session_unavailable", "host_memory_pressure")
    const { manager, store } = makeManager({ process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(
      "The task host refused the child session (host_memory_pressure).",
    )
    const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
    expect(eventLog).toContain('"failure_reason":"host_memory_pressure"')
    expect(eventLog).not.toContain(PRIVATE_DETAIL)
  })

  test("#given an off-enum host reason #when start fails #then no untrusted value reaches any public or durable surface", async () => {
    // given
    const runner = new FakeRunner()
    const offEnum = closedRunnerError("session_unavailable", "open_timed_out")
    Object.defineProperty(offEnum.failure, "reason", { value: PRIVATE_DETAIL })
    runner.startError = offEnum
    const { manager, store } = makeManager({ process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe("The task host could not open the child session.")
    expect(result.failure_reason).toBeUndefined()
    const record = store.load(result.task_id)
    const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
    expect(JSON.stringify({ result, record, eventLog })).not.toContain(PRIVATE_DETAIL)
  })
})
