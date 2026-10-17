import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../runners/in-process"
import { CTX, createFakeManager, makeDeps } from "../tools/task/__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "../tools/task/execute"
import { FakeRunner, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

const SECRET = "ENOENT /Users/alice/.config/senpi/credentials.json api_key=sk-live-secret"

afterEach(cleanupProjects)

function senpiCommandError(errorCode: unknown): Error {
  return Object.assign(new Error(`host refused: ${SECRET}`), { name: "RpcCommandError", errorCode })
}

function transportGoneError(): Error {
  return Object.assign(new Error(`Shared RPC host is unavailable ${SECRET}`), { code: "rpc_transport_gone" })
}

async function startWithCause(cause: unknown, kind: "child-prompt-failed" | "session_unavailable" = "child-prompt-failed") {
  const runner = new FakeRunner()
  runner.startError = new RunnerError({ kind, message: SECRET, cause, rejected_while: "alive" })
  const { manager, store } = makeManager({ process: runner })
  const result = await manager.start({
    prompt: "private prompt payload",
    parent_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    category: "quick",
  })
  if (result.kind !== "start_failed") throw new Error("expected start_failed")
  const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
  const event = JSON.parse(eventLog.trim().split("\n").at(-1) ?? "{}") as { type?: string; payload?: Record<string, unknown> }
  const record = readFileSync(join(store.stateDir, "tasks", `${result.task_id}.json`), "utf8")
  return { result, event, eventLog, record, persisted: store.load(result.task_id) }
}

describe("task start failure cause", () => {
  test("#given the host never answers the first prompt #when the start failure is recorded #then the record, the event and the result name a request timeout and keep the stderr out", async () => {
    // given
    const cause = new Error(`Timeout waiting for response to prompt. Stderr: ${SECRET}`)

    // when
    const { result, event, eventLog, record, persisted } = await startWithCause(cause)

    // then
    const message = "Child prompt failed to start: no answer to the prompt request in time (request_timeout)."
    expect(result.error_message).toBe(message)
    expect(persisted?.error_message).toBe(message)
    expect(event).toEqual({
      type: "task_start_failed",
      payload: {
        error_message: message,
        failure_kind: "child-prompt-failed",
        rejected_while: "alive",
        cause_class: "request_timeout",
        timed_out_command: "prompt",
      },
    })
    expect(JSON.stringify({ result, eventLog, record })).not.toContain("sk-live-secret")
  })

  test("#given the host refuses the prompt with a typed error code #when the start failure is recorded #then the refusal and its code are named", async () => {
    // when
    const { result, event } = await startWithCause(senpiCommandError("host_memory_pressure"))

    // then
    expect(result.error_message).toBe(
      "Child prompt failed to start: the prompt was refused (host_refused: host_memory_pressure).",
    )
    expect(event.payload).toMatchObject({ cause_class: "host_refused", cause_code: "host_memory_pressure" })
  })

  test.each([
    ["a secret", SECRET],
    ["not a string", 42],
    ["too long", "x".repeat(80)],
  ])("#given a refusal whose error code is %s #when the start failure is recorded #then the refusal is named without the code", async (_label, errorCode) => {
    // when
    const { result, event, eventLog } = await startWithCause(senpiCommandError(errorCode))

    // then
    expect(result.error_message).toBe("Child prompt failed to start: the prompt was refused (host_refused).")
    expect(event.payload).toMatchObject({ cause_class: "host_refused" })
    expect(event.payload).not.toHaveProperty("cause_code")
    expect(eventLog).not.toContain("sk-live-secret")
  })

  test("#given the host connection is lost while the first prompt waits #when the start failure is recorded #then a lost transport is named", async () => {
    // when
    const { result, event } = await startWithCause(transportGoneError())

    // then
    expect(result.error_message).toBe(
      "Child prompt failed to start: the connection to the child was lost (transport_lost).",
    )
    expect(event.payload).toMatchObject({ cause_class: "transport_lost" })
  })

  test("#given a resumed child whose session cannot be reopened because the host timed out #when the start failure is recorded #then the session refusal names the timeout", async () => {
    // given
    const cause = new Error(`Timeout waiting for response to switch_session. Stderr: ${SECRET}`)

    // when
    const { result, event } = await startWithCause(cause, "session_unavailable")

    // then
    expect(result.error_message).toBe(
      "The child session could not be opened: no answer to the switch_session request in time (request_timeout).",
    )
    expect(event.payload).toMatchObject({ cause_class: "request_timeout", timed_out_command: "switch_session" })
  })

  test("#given the child process crashed before accepting its first prompt #when the start failure is recorded #then the message names the exit and keeps the stderr out", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "child-prompt-failed",
      message: SECRET,
      cause: new Error(SECRET),
      rejected_while: "exited",
      exit: { kind: "crashed", code: 1, signal: null },
    })
    const { manager, store } = makeManager({ process: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      category: "quick",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    const message = "Child prompt failed to start: the child process exited before accepting it (crashed, code 1)."
    expect(result.error_message).toBe(message)
    expect(store.load(result.task_id)?.error_message).toBe(message)
    expect(JSON.stringify(result)).not.toContain("sk-live-secret")
  })

  test("#given a cause that matches no known class #when the start failure is recorded #then the stable message and payload stay unchanged", async () => {
    // when
    const { result, event } = await startWithCause(new Error(SECRET))

    // then
    expect(result.error_message).toBe("Child prompt failed to start.")
    expect(event.payload).not.toHaveProperty("cause_class")
  })

  test("#given a host timeout #when the task tool reports the start failure #then the caller sees the named cause", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "child-prompt-failed",
      message: SECRET,
      cause: new Error(`Timeout waiting for response to prompt. Stderr: ${SECRET}`),
      rejected_while: "alive",
    })
    const { manager } = makeManager({ inProcess: runner })
    const recordingManager = createFakeManager({ start: (spec) => manager.start(spec) })

    // when
    const result = await buildTaskExecute(makeDeps(recordingManager))(
      "call-named-start-failure",
      { prompt: "private prompt payload", category: "quick", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    const content = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(content).toBe("Child prompt failed to start: no answer to the prompt request in time (request_timeout).")
    expect(JSON.stringify(result)).not.toContain("sk-live-secret")
  })
})
