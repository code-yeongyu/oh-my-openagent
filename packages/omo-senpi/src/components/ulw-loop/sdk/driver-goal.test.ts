import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readDriverGoalJson } from "./driver-goal"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(contents: string[]) {
  const root = mkdtempSync(join(tmpdir(), "sdk-driver-"))
  roots.push(root)
  return { root, paths: contents.map((body, i) => { const path = join(root, `${i}.json`); writeFileSync(path, body); return path }) }
}

test("#given missing and invalid stores #when read #then first valid snapshot wins with warnings and no writes", () => {
  const goal = { objective: "driver", status: "active" }
  const bodies = ["{bad", JSON.stringify({ version: 2, goal }), JSON.stringify({ version: 1, goal })]
  const { root, paths } = fixture(bodies)
  const result = readDriverGoalJson([join(root, "missing"), ...paths])
  expect(result.codexGoalJson).toBe(JSON.stringify({ goal }))
  expect(result.warnings).toHaveLength(2)
  expect(readdirSync(root).sort()).toEqual(["0.json", "1.json", "2.json"])
  expect(paths.map(path => readFileSync(path, "utf8"))).toEqual(bodies)
})

test("#given authoritative goal null #when a fallback contains a stale goal #then reading stops", () => {
  const { paths } = fixture([JSON.stringify({ version: 1, goal: null }), JSON.stringify({ version: 1, goal: { objective: "stale" } })])
  expect(readDriverGoalJson(paths)).toEqual({ codexGoalJson: undefined, warnings: [] })
})
