import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerProcess } from "./optout-purge.test-support"
import { legacyRollupDir, removeLegacyRollups } from "./session-summary-legacy-rollups"
import { createTransportRecorder, withTempAgentDir } from "./telemetry.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-legacy-rollups-"))
  roots.push(root)
  return root
}

// A pre-#10225 rollup as v5.1.44 wrote it: one JSON file per session, plus its temp and claim siblings.
function seedLegacyRollups(stateDir: string): string {
  const dir = legacyRollupDir(stateDir)
  mkdirSync(dir, { recursive: true })
  const rollup = JSON.stringify({ v: 1, pid: 4242, sessionHash: "hashed:old", sessionRole: "main", nextSeq: 3, window: { turns: 2 }, updatedAt: 1, consent: "enabled", scope: { cwd: "/repo" } })
  writeFileSync(join(dir, "hashed_old.json"), rollup)
  writeFileSync(join(dir, "hashed_old.json.4242.tmp"), rollup)
  writeFileSync(join(dir, "hashed_gone.json.claimed-4242"), rollup)
  return dir
}

describe("pre-#10225 rollups are removed", () => {
  test("#given rollup files, a temp and a claim #when removed #then the files and the emptied directory are gone", () => {
    const stateDir = tempRoot()
    const dir = seedLegacyRollups(stateDir)

    const result = removeLegacyRollups(stateDir)

    expect(result).toEqual({ removed: 3, skipped: 0, failed: 0 })
    expect(existsSync(dir)).toBe(false)
  })

  test("#given a subdirectory inside rollups #when removed #then the files go and the subdirectory and its directory stay", () => {
    const stateDir = tempRoot()
    const dir = seedLegacyRollups(stateDir)
    mkdirSync(join(dir, "nested"))
    writeFileSync(join(dir, "nested", "keep.txt"), "x")

    const result = removeLegacyRollups(stateDir)

    expect(result).toEqual({ removed: 3, skipped: 1, failed: 0 })
    expect(readdirSync(dir)).toEqual(["nested"])
    expect(readFileSync(join(dir, "nested", "keep.txt"), "utf8")).toBe("x")
  })

  test("#given rollups is a link to another directory #when removed #then only the link goes and the target is untouched", () => {
    const stateDir = tempRoot()
    const elsewhere = tempRoot()
    writeFileSync(join(elsewhere, "precious.json"), "{}")
    mkdirSync(stateDir, { recursive: true })
    symlinkSync(elsewhere, legacyRollupDir(stateDir), "dir")

    const result = removeLegacyRollups(stateDir)

    expect(result).toEqual({ removed: 1, skipped: 0, failed: 0 })
    expect(existsSync(legacyRollupDir(stateDir))).toBe(false)
    expect(readdirSync(elsewhere)).toEqual(["precious.json"])
  })

  test("#given a link inside rollups to a file elsewhere #when removed #then the link goes and its target is untouched", () => {
    const stateDir = tempRoot()
    const elsewhere = tempRoot()
    const target = join(elsewhere, "precious.json")
    writeFileSync(target, "{}")
    mkdirSync(legacyRollupDir(stateDir), { recursive: true })
    symlinkSync(target, join(legacyRollupDir(stateDir), "hashed_link.json"))

    const result = removeLegacyRollups(stateDir)

    expect(result).toEqual({ removed: 1, skipped: 0, failed: 0 })
    expect(readFileSync(target, "utf8")).toBe("{}")
  })

  test("#given more files than the limit #when removed #then one pass removes exactly the limit and the next pass finishes", () => {
    const stateDir = tempRoot()
    const dir = legacyRollupDir(stateDir)
    mkdirSync(dir, { recursive: true })
    for (let index = 0; index < 5; index += 1) writeFileSync(join(dir, `hashed_${index}.json`), "{}")

    expect(removeLegacyRollups(stateDir, 2)).toEqual({ removed: 2, skipped: 3, failed: 0 })
    expect(readdirSync(dir)).toHaveLength(3)
    expect(removeLegacyRollups(stateDir, 10)).toEqual({ removed: 3, skipped: 0, failed: 0 })
    expect(existsSync(dir)).toBe(false)
  })

  test("#given no rollups directory #when removed #then nothing happens", () => {
    expect(removeLegacyRollups(tempRoot())).toEqual({ removed: 0, skipped: 0, failed: 0 })
  })

  test("#given a subdirectory left inside rollups #when a process registers #then the skip is not reported as a write failure", async () => {
    await withTempAgentDir(async (agentDir) => {
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const dir = seedLegacyRollups(stateDir)
      mkdirSync(join(dir, "nested"))
      const diagnostics: Array<{ readonly event: string; readonly source?: string; readonly count?: number }> = []

      await registerProcess({ agentDir, recorder: createTransportRecorder(), env: {}, cwd: "/repo", options: { isConfigEnabled: () => true, stateDir, diagnostics: (input) => diagnostics.push(input) } })

      expect(readdirSync(dir)).toEqual(["nested"])
      expect(diagnostics.filter(({ event }) => event === "telemetry_activity_state_write_failed")).toEqual([])
    })
  })

  // Lead ruling (2026-10-24): nothing reads rollups/ any more, so the data goes for every upgrader, opted in or not.
  for (const [label, setup] of [
    ["opted in", { env: {}, options: { isConfigEnabled: () => true } }],
    ["opted out by the persisted setting", { env: {}, options: { isConfigEnabled: () => false } }],
    ["opted out by DO_NOT_TRACK only", { env: { DO_NOT_TRACK: "1" }, options: { isConfigEnabled: () => true } }],
  ] as const) {
    test(`#given leftover rollups #when a process ${label} registers #then they are gone before any event and the log carries only a count`, async () => {
      await withTempAgentDir(async (agentDir) => {
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const dir = seedLegacyRollups(stateDir)
        const diagnostics: Array<{ readonly event: string; readonly source?: string; readonly count?: number }> = []

        await registerProcess({ agentDir, recorder: createTransportRecorder(), env: setup.env, cwd: "/repo", options: { ...setup.options, stateDir, diagnostics: (input) => diagnostics.push(input) } })

        expect(existsSync(dir)).toBe(false)
        const logged = diagnostics.filter(({ event }) => event === "telemetry_legacy_rollups_removed")
        expect(logged).toEqual([{ event: "telemetry_legacy_rollups_removed", source: "omo-native-component", count: 3 }])
        expect(JSON.stringify(diagnostics)).not.toContain("hashed_")
      })
    })
  }
})
