import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { recordMemoryChildDeath } from "./memory-child-death-record"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-child-death-"))
  dirs.push(dir)
  return dir
}

function records(dir: string): unknown[] {
  const file = join(dir, "process-crashes", "crashes.jsonl")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line))
}

const START = Date.parse("2026-10-16T17:22:11.628Z")

test("#given the supervisor's deadline was reached #when the child dies by SIGKILL #then no crash is recorded", () => {
  const dir = agentDir()
  recordMemoryChildDeath({
    env: { OMO_CODING_AGENT_DIR: dir },
    exit: { code: null, signal: "SIGKILL" },
    timedOut: true,
    startedAt: START,
    now: START + 180_003,
  })
  expect(records(dir)).toEqual([])
})

test("#given no deadline was reached #when the child dies by a fatal signal #then the supervisor records it as a parent-detected print crash", () => {
  const dir = agentDir()
  recordMemoryChildDeath({
    env: { OMO_CODING_AGENT_DIR: dir },
    exit: { code: null, signal: "SIGSEGV" },
    timedOut: false,
    startedAt: START,
    now: START + 42_000,
  })
  expect(records(dir)).toEqual([
    expect.objectContaining({ kind: "print", detection: "parent", signal: "SIGSEGV", uptimeMs: 42_000 }),
  ])
})

test("#given no deadline was reached #when the child exits by code or a shutdown signal #then nothing is recorded", () => {
  const dir = agentDir()
  for (const exit of [{ code: 1, signal: null }, { code: 0, signal: null }, { code: null, signal: "SIGTERM" }]) {
    recordMemoryChildDeath({ env: { OMO_CODING_AGENT_DIR: dir }, exit, timedOut: false, startedAt: START, now: START + 1 })
  }
  expect(records(dir)).toEqual([])
})
