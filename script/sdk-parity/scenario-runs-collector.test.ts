import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadScenarioRuns } from "./conformance-run"

// Architecture contract (design lane ruling): each slice keeps its scenario drivers in its own module under runs/, and
// the one collector reads them all, so no two slices edit one list and no scenario is driven twice.
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const runsModule = (ids: readonly string[]) =>
  `export const runs = ${JSON.stringify(ids)}.map((id) => ({ scenario: { id, row: "r", kind: "effect", input: {}, expect: [] }, setup: () => ({ root: {}, calls: () => [] }) }))\n`

function runsDir(modules: Readonly<Record<string, readonly string[]>>): string {
  const dir = mkdtempSync(join(tmpdir(), "sdk-parity-runs-"))
  dirs.push(dir)
  for (const [name, ids] of Object.entries(modules)) writeFileSync(join(dir, name), runsModule(ids))
  writeFileSync(join(dir, "ignored.test.ts"), runsModule(["test-only"]))
  return dir
}

describe("the scenario-run collector", () => {
  test("#given two namespace modules in runs/ #when the runs are collected #then every run of both is there and a test file is not read", async () => {
    const runs = await loadScenarioRuns(runsDir({ "devices.ts": ["devices.list/a"], "threads.ts": ["threads.list/b"] }))
    expect(runs.map((run) => run.scenario.id)).toEqual(["devices.list/a", "threads.list/b"])
  })

  test("#given one scenario id in two modules #when the runs are collected #then the collector refuses, naming both modules", async () => {
    const dir = runsDir({ "devices.ts": ["shared/a"], "threads.ts": ["shared/a"] })
    await expect(loadScenarioRuns(dir)).rejects.toThrow(
      "scenario shared/a is run by both runs/devices.ts and runs/threads.ts",
    )
  })

  test("#given no runs directory #when the runs are collected #then there are none", async () => {
    expect(await loadScenarioRuns(join(tmpdir(), "sdk-parity-runs-absent"))).toEqual([])
  })
})
