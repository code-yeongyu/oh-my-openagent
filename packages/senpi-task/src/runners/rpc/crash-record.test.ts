import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"

// oh-my-openagent#8931: a process-mode task child is watched by this parent, so its unexpected death
// is recorded here, in the crashes.jsonl the OmO telemetry reporter reads.
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness(): { readonly agentDir: string; readonly child: EventEmitter; readonly terminate: () => void } {
  const agentDir = mkdtempSync(join(tmpdir(), "senpi-task-crash-"))
  dirs.push(agentDir)
  const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null, kill: () => true })
  const client = {
    stderrTail: "",
    exited: false,
    send: () => Promise.resolve({ success: true }),
    onEvent: () => () => undefined,
    detach: () => undefined,
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({
    client,
    child: child as unknown as ChildProcess,
    taskId: "st_00000001",
    heartbeatIntervalMs: 60_000,
    now: () => 1,
    childEnv: { OMO_CODING_AGENT_DIR: agentDir },
  })
  return { agentDir, child, terminate: () => void handle.terminate({ sigkillDelayMs: 1 }) }
}

function records(agentDir: string): readonly Record<string, unknown>[] {
  const file = join(agentDir, "process-crashes", "crashes.jsonl")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("process-mode task child crash records", () => {
  test("#given a child that dies of SIGSEGV #when it closes #then one parent-detected record names the signal and uptime", () => {
    // given
    const { agentDir, child } = harness()

    // when
    child.emit("close", null, "SIGSEGV")

    // then
    const [record, ...rest] = records(agentDir)
    expect(rest).toEqual([])
    expect(record).toEqual({
      at: expect.any(String),
      kind: "task-child",
      detection: "parent",
      signal: "SIGSEGV",
      uptimeMs: expect.any(Number),
      ...(process.versions.bun === undefined ? {} : { bunVersion: process.versions.bun }),
    })
    expect(Number.isNaN(Date.parse(String(record?.at)))).toBe(false)
  })

  test("#given a child that exits non-zero on its own #when it closes #then the exit code is recorded", () => {
    // given
    const { agentDir, child } = harness()

    // when
    child.emit("close", 3221225477, null)

    // then
    expect(records(agentDir).map((record) => record.code)).toEqual([3221225477])
  })

  test.each([
    ["a clean exit", 0, null],
    ["a SIGTERM shutdown", null, "SIGTERM"],
    ["senpi's own SIGHUP handler exit", 129, null],
  ])("#given %s #when the child closes #then nothing is recorded", (_name, code, signal) => {
    // given
    const { agentDir, child } = harness()

    // when
    child.emit("close", code, signal)

    // then
    expect(records(agentDir)).toEqual([])
  })

  test("#given the parent terminated the child #when it dies of SIGKILL #then the requested stop is not a crash", () => {
    // given
    const { agentDir, child, terminate } = harness()
    terminate()

    // when
    child.emit("close", null, "SIGKILL")

    // then
    expect(records(agentDir)).toEqual([])
  })
})
