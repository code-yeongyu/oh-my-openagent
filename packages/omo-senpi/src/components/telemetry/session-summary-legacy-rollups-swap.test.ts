import { afterEach, describe, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Swaps `rollups` for a link to another folder between the pass's first check and its deletes: the only
// point the real filesystem offers no hook for, so `readdirSync` runs the swap just before it lists.
const real = { ...fs }
let beforeNextList: (() => void) | undefined
mock.module("node:fs", () => ({
  ...real,
  readdirSync: (...args: Parameters<typeof fs.readdirSync>) => {
    const swap = beforeNextList
    beforeNextList = undefined
    swap?.()
    return real.readdirSync(...args)
  },
}))

const { legacyRollupDir, removeLegacyRollups } = await import("./session-summary-legacy-rollups")

const roots: string[] = []
afterEach(() => {
  beforeNextList = undefined
  for (const root of roots.splice(0)) real.rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = real.mkdtempSync(join(tmpdir(), "omo-legacy-rollups-swap-"))
  roots.push(root)
  return root
}

describe("pre-#10225 rollups removal under a swap", () => {
  test("#given rollups is swapped for a link after the pass checked it #when the pass deletes #then nothing in the link's target is touched", () => {
    const stateDir = tempRoot()
    const elsewhere = tempRoot()
    const dir = legacyRollupDir(stateDir)
    real.mkdirSync(dir, { recursive: true })
    for (const name of ["hashed_a.json", "hashed_b.json"]) {
      real.writeFileSync(join(dir, name), "{}")
      real.writeFileSync(join(elsewhere, name), "precious")
    }
    beforeNextList = () => {
      real.renameSync(dir, `${dir}.moved`)
      real.symlinkSync(elsewhere, dir, "dir")
    }

    const result = removeLegacyRollups(stateDir)

    expect(real.readdirSync(elsewhere).sort()).toEqual(["hashed_a.json", "hashed_b.json"])
    expect(real.readFileSync(join(elsewhere, "hashed_a.json"), "utf8")).toBe("precious")
    expect(result).toEqual({ removed: 0, skipped: 2, failed: 0 })
  })
})
