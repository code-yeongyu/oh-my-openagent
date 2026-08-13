import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { recoverBeta7NestedAgentState } from "../bin/lib/beta7-nested-state-recovery.js"

const roots: string[] = []

function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-recovery-"))
  roots.push(root)
  return root
}

function writeState(root: string, ...segments: string[]): void {
  const path = join(root, ...segments)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "{}")
}

const STATE_FILES = ["settings.json", "auth.json", "models.json"] as const

describe("beta.7 nested agent-state recovery", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  describe("#given beta.7 nested state under ~/.omo/agent and no flat state", () => {
    test("#then the state files are copied flat, never moved", () => {
      const home = makeHome()
      for (const name of STATE_FILES) writeState(home, ".omo", "agent", name)

      const copied = recoverBeta7NestedAgentState(home)

      expect(copied.sort()).toEqual([...STATE_FILES].sort())
      for (const name of STATE_FILES) {
        expect(existsSync(join(home, ".omo", name))).toBe(true)
        expect(readFileSync(join(home, ".omo", name), "utf8")).toBe("{}")
        expect(existsSync(join(home, ".omo", "agent", name))).toBe(true)
      }
    })

    test("#then a partial nested set copies only the files that exist", () => {
      const home = makeHome()
      writeState(home, ".omo", "agent", "auth.json")

      const copied = recoverBeta7NestedAgentState(home)

      expect(copied).toEqual(["auth.json"])
      expect(existsSync(join(home, ".omo", "auth.json"))).toBe(true)
      expect(existsSync(join(home, ".omo", "settings.json"))).toBe(false)
    })

    test("#then a second run is a no-op", () => {
      const home = makeHome()
      for (const name of STATE_FILES) writeState(home, ".omo", "agent", name)

      expect(recoverBeta7NestedAgentState(home).length).toBe(STATE_FILES.length)
      expect(recoverBeta7NestedAgentState(home)).toEqual([])
    })
  })

  describe("#given flat state already exists", () => {
    test("#then existing flat files are never overwritten", () => {
      const home = makeHome()
      writeState(home, ".omo", "agent", "settings.json")
      const flat = join(home, ".omo", "settings.json")
      mkdirSync(join(home, ".omo"), { recursive: true })
      writeFileSync(flat, "{\"keep\": true}")

      const copied = recoverBeta7NestedAgentState(home)

      expect(copied).toEqual([])
      expect(readFileSync(flat, "utf8")).toBe("{\"keep\": true}")
    })

    test("#then nothing is copied when the flat sentinel exists even with nested state", () => {
      const home = makeHome()
      writeState(home, ".omo", "agent", "auth.json")
      writeState(home, ".omo", "settings.json")

      expect(recoverBeta7NestedAgentState(home)).toEqual([])
      expect(existsSync(join(home, ".omo", "auth.json"))).toBe(false)
    })
  })

  describe("#given no beta.7 nested state", () => {
    test("#then the recovery is a no-op and creates no directories", () => {
      const home = makeHome()

      expect(recoverBeta7NestedAgentState(home)).toEqual([])
      expect(existsSync(join(home, ".omo"))).toBe(false)
    })
  })
})
