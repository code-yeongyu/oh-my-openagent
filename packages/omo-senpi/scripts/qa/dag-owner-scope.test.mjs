import { describe, expect, test } from "bun:test"
import { appendFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createDagFileStore } from "../../../senpi-task/src/dag/store.ts"
import { readDagNodeResult } from "../../../senpi-task/src/dag/results.ts"
import { createSandbox } from "./drive.mjs"
import { evaluate, selfTest } from "./dag-owner-scope.mjs"
import * as fixture from "./dag-owner-scope-fixture.mjs"
import { SESSION_A, SESSION_B, seedRun, snapshot } from "./dag-owner-scope-fixture.mjs"

describe("synthetic DAG selection evidence", () => {
  test("accepts the fixture through the real checkpoint and completed-result readers", () => {
    // given
    const sandbox = createSandbox()
    try {
      const record = seedRun(sandbox.root, "a", SESSION_A, 999999)
      const store = createDagFileStore({ task: { state_dir: sandbox.root } })
      // when
      const checkpoint = store.readCheckpoint("a")
      const result = readDagNodeResult({ store, runId: "a", nodeId: "done" })
      // then
      expect(checkpoint).toEqual(record)
      expect(checkpoint.status).toBe("paused")
      expect(checkpoint.nodes.every((node) => node.state === "completed")).toBe(true)
      expect(result).toEqual({ output: "SYNTHETIC_COMPLETED_OUTPUT\n" })
    } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
  })

  test("snapshot keys use posix separators so evaluate() prefixes match on every platform", () => {
    // given
    const sandbox = createSandbox()
    try {
      seedRun(sandbox.root, "a", SESSION_A, 999999)
      // when
      const keys = Object.keys(snapshot(sandbox.root).files)
      // then
      expect(keys).toEqual(["dag/events/a.jsonl", "dag/results/a/done.txt", "dag/runs/a.json"])
      expect(fixture.toPosixKey("dag\\events\\a.jsonl")).toBe("dag/events/a.jsonl")
      expect(fixture.toPosixKey("dag/results/a/done.txt")).toBe("dag/results/a/done.txt")
    } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
  })

  test("detects an unrelated event mutation even without checkpoint reparenting", () => {
    // given
    const sandbox = createSandbox()
    try {
      seedRun(sandbox.root, "a", SESSION_A, 999999)
      const before = { ids: ["a"], current: SESSION_B, state: snapshot(sandbox.root) }
      // when
      appendFileSync(join(sandbox.root, "dag/events/a.jsonl"), '{"type":"dag.run.resumed"}\n')
      const result = evaluate(before, { state: snapshot(sandbox.root) }, [])
      // then
      expect(result.ok).toBe(false)
      expect(result.forbiddenMutations).toEqual(["a"])
      expect(result.changedPaths).toEqual(["dag/events/a.jsonl"])
    } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
  })

  test("does not mistake no recovery for a healthy own-session control", () => {
    // given
    const sandbox = createSandbox()
    try {
      seedRun(sandbox.root, "b-own", SESSION_B, 999999)
      const before = { ids: ["b-own"], current: SESSION_B, state: snapshot(sandbox.root) }
      // when
      const result = evaluate(before, { state: snapshot(sandbox.root) }, ["b-own"])
      // then
      expect(result.ok).toBe(false)
      expect(result.healthyOwnRecovery).toBe(false)
    } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
  })

  test("driver self-test detects ownership changes and rejects invalid options", () => {
    expect(selfTest()).toEqual({ ok: true })
  })
})
