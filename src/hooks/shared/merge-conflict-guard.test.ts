import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue
      }
      yield* walk(path)
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".json"))) {
      yield path
    }
  }
}

function hasConflictMarkers(content: string): boolean {
  const lines = content.split("\n")
  return lines.some((line) =>
    line.startsWith("<<<<<<< ") ||
    line === "=======" ||
    line.startsWith(">>>>>>> ")
  )
}

describe("#given source files in src/", () => {
  test("#then no file contains unresolved git merge conflict markers", () => {
    const conflicts: string[] = []
    for (const path of walk(join(import.meta.dir, "../../../src"))) {
      const content = readFileSync(path, "utf-8")
      if (hasConflictMarkers(content)) {
        conflicts.push(path)
      }
    }
    expect(conflicts).toEqual([])
  })
})
