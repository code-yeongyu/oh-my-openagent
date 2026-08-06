import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createTaskRecordStore } from "../store"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

const cleanupRoots: string[] = []
const raceChildFixturePath = resolve(import.meta.dir, "__fixtures__", "batch-admission-race-child.ts")

afterEach(() => {
  cleanupProjects()
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function iso(offsetMs: number): string {
  return new Date(1_000_000 + offsetMs).toISOString()
}

type ChildRaceResult = {
  readonly pid: number
  readonly lease: string
  readonly claimed: readonly string[]
}

function parseRaceResult(output: string): ChildRaceResult {
  const line = output
    .split("\n")
    .filter((entry) => entry.startsWith("{"))
    .at(-1)
  if (line === undefined) throw new Error(`Child did not emit a JSON result:\n${output}`)
  return JSON.parse(line) as ChildRaceResult
}

describe("admitSuspendedBatch two-OS-process race", () => {
  test(
    "#given two OS processes over one store with 8 suspended and cap 5 #when both admit from a shared barrier #then total claims never exceed the cap and never duplicate",
    async () => {
      // given: one store, 8 suspended candidates, cap 5, zero current residents
      const store = tempStore()
      const ids = ["st_00000090", "st_00000091", "st_00000092", "st_00000093", "st_00000094", "st_00000095", "st_00000096", "st_00000097"]
      ids.forEach((id, index) => {
        seedRecord(store, {
          task_id: id,
          status: index % 2 === 0 ? "running" : "completed",
          residency_state: index % 3 === 0 ? "rpc_detached" : "persisted_only",
          updated_at: iso(index * 10),
        })
      })
      const barrierDir = mkdtempSync(join(tmpdir(), "senpi-task-barrier-"))
      cleanupRoots.push(barrierDir)
      const children = ["a", "b"].map((tag) =>
        Bun.spawn([process.execPath, raceChildFixturePath, store.stateDir, "parent-1", "5", barrierDir, tag], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      )
      const stdout = children.map((child) => new Response(child.stdout).text())
      const stderr = children.map((child) => new Response(child.stderr).text())

      // when: both children are released from the shared barrier at the same instant
      const deadline = Date.now() + 15_000
      while (!(existsSync(join(barrierDir, "ready-a")) && existsSync(join(barrierDir, "ready-b")))) {
        if (Date.now() > deadline) throw new Error("children never signalled ready")
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      writeFileSync(join(barrierDir, "barrier"), "go")
      const [exitCodes, outputs, errors] = await Promise.all([
        Promise.all(children.map((child) => child.exited)),
        Promise.all(stdout),
        Promise.all(stderr),
      ])

      // then: both batches completed and their COMBINED claims respect the cap exactly
      for (const [index, exitCode] of exitCodes.entries()) {
        expect(exitCode, `stdout:\n${outputs[index]}\nstderr:\n${errors[index]}`).toBe(0)
      }
      const results = outputs.map(parseRaceResult)
      const claimed = results.flatMap((result) => result.claimed)
      expect(new Set(claimed).size).toBe(claimed.length)
      expect(claimed).toHaveLength(5)

      // and the persisted state agrees: exactly 5 residents, 3 still suspended, none lost
      const fresh = createTaskRecordStore({ project_dir: store.stateDir, task: { state_dir: store.stateDir } })
      const records = fresh.list().records.filter((record) => record.parent_session_id === "parent-1")
      expect(records.filter((record) => record.residency_state === "resident")).toHaveLength(5)
      expect(
        records.filter((record) => record.residency_state === "persisted_only" || record.residency_state === "rpc_detached"),
      ).toHaveLength(3)

      // and every claim is stamped with one of the two CHILD pids - proof the claims crossed processes
      const childPids = new Set(results.map((result) => result.pid))
      expect(childPids.size).toBe(2)
      for (const record of records) {
        if (record.residency_state !== "resident") continue
        expect(childPids.has(record.host_pid ?? -1)).toBe(true)
      }
    },
    30_000,
  )
})
