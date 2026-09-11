import type { ChildProcess } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../runners/in-process"
import { RpcProcessRunner } from "../runners/rpc-process"
import { spawnFakeChild } from "../runners/rpc/__fixtures__/spawn-fake"
import { terminateRpcChild } from "../runners/rpc/terminate"
import { createRpcManagedRunner } from "./runner"
import { FakeRunner, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

// The same shape start-failure-security.test.ts uses: a cause carrying a credential, so any test that
// persists free text fails loudly instead of leaking quietly.
const SECRET_BEARING_STDERR = "ENOENT /Users/alice/.config/senpi/credentials.json api_key=sk-live-secret"
const PUBLIC_START_FAILURE = "Child prompt failed to start."

const spawned: ChildProcess[] = []

afterEach(async () => {
  while (spawned.length > 0) {
    const child = spawned.pop()
    if (child) await terminateRpcChild(child, { sigkillDelayMs: 200 })
  }
  cleanupProjects()
})

function readOnlyEventLog(stateDir: string): string {
  const logsDir = join(stateDir, "logs")
  const entries = readdirSync(logsDir).filter((entry) => entry.endsWith(".jsonl"))
  const only = entries[0]
  if (only === undefined || entries.length !== 1) {
    throw new Error(`expected exactly one event log, got ${JSON.stringify(entries)}`)
  }
  return readFileSync(join(logsDir, only), "utf8")
}

describe("TaskManager start failure diagnostics", () => {
  test("#given a child that died with a classified exit #when the start failure is recorded #then the event log carries the structured exit facts and none of the stderr text", async () => {
    // given: the child reached a real process exit, so the runner error carries its classified facts
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "child-prompt-failed",
      message: SECRET_BEARING_STDERR,
      cause: new Error(SECRET_BEARING_STDERR),
      rejected_while: "exited",
      exit: { kind: "crashed", code: 1, signal: null },
    })
    const { manager, store } = makeManager({ inProcess: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
    })

    // then: the cause is finally answerable - which exit, which code - instead of a bare status=error
    expect(result.kind).toBe("start_failed")
    const eventLog = readOnlyEventLog(store.stateDir)
    const event = JSON.parse(eventLog.trim().split("\n").at(-1) ?? "{}") as {
      type?: string
      payload?: Record<string, unknown>
    }
    expect(event.type).toBe("task_start_failed")
    expect(event.payload).toEqual({
      error_message: PUBLIC_START_FAILURE,
      failure_kind: "child-prompt-failed",
      rejected_while: "exited",
      exit_kind: "crashed",
      exit_code: 1,
      exit_signal: null,
    })

    // and: the stderr-derived message never reaches the durable artifact. store/redaction.ts redacts
    // by KEY name only, so a free-text value would have been written verbatim.
    expect(eventLog).not.toContain(SECRET_BEARING_STDERR)
    expect(eventLog).not.toContain("sk-live-secret")
    expect(eventLog).not.toContain("credentials.json")
  })

  test("#given an rpc prompt rejects while its child is alive #when the manager records startup failure #then the breadcrumb says alive without invented exit facts", async () => {
    // given: the real RPC runner sees a stdin-side rejection before cleanup terminates its child.
    const rpcRunner = new RpcProcessRunner({
      modelAdmission: async () => {},
      buildSpawn: (spec) => ({ command: process.execPath, args: [], cwd: spec.cwd, env: process.env }),
      spawnChild: () => {
        const child = spawnFakeChild()
        spawned.push(child)
        const stdin = child.stdin
        if (stdin === null) throw new Error("fake child stdin was not piped")
        const write = (...args: unknown[]): boolean => {
          const callback = args.findLast((value): value is (error: Error) => void => typeof value === "function")
          callback?.(new Error(SECRET_BEARING_STDERR))
          return false
        }
        Object.defineProperty(stdin, "write", { value: write })
        return child
      },
    })
    const { manager, store } = makeManager({ process: createRpcManagedRunner(rpcRunner) })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      category: "quick",
    })

    // then
    expect(result.kind).toBe("start_failed")
    const eventLog = readOnlyEventLog(store.stateDir)
    const event = JSON.parse(eventLog.trim().split("\n").at(-1) ?? "{}") as {
      type?: string
      payload?: Record<string, unknown>
    }
    expect(event.type).toBe("task_start_failed")
    expect(event.payload).toEqual({
      error_message: PUBLIC_START_FAILURE,
      failure_kind: "child-prompt-failed",
      rejected_while: "alive",
    })
    expect(event.payload).not.toHaveProperty("exit_kind")
    expect(eventLog).not.toContain("sk-live-secret")

    // and: the stderr-derived message is still excluded from the durable artifact.
    expect(eventLog).not.toContain("credentials.json")
  })

  test("#given a start failure that never reached a process exit #when it is recorded #then the failure kind alone is persisted", async () => {
    // given: no exit facts exist, because no child process was ever created
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "session-create-failed",
      message: SECRET_BEARING_STDERR,
      cause: new Error(SECRET_BEARING_STDERR),
    })
    const { manager, store } = makeManager({ inProcess: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
    })

    // then: a partial fact set is still a fact set; the absent exit is simply absent, not invented
    expect(result.kind).toBe("start_failed")
    const eventLog = readOnlyEventLog(store.stateDir)
    const event = JSON.parse(eventLog.trim().split("\n").at(-1) ?? "{}") as {
      type?: string
      payload?: Record<string, unknown>
    }
    expect(event.payload).toEqual({
      error_message: "In-process child session creation failed.",
      failure_kind: "session-create-failed",
    })
    expect(eventLog).not.toContain("sk-live-secret")
  })
})
