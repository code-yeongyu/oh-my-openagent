import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const docs = ["docs/guide/computer-use.md", "docs/reference/computer.md"]
const sourcePath = /`((?:packages|crates)\/[^`\s*{}]+)`/g

export function citedPaths(markdown) {
  return [...markdown.matchAll(sourcePath)].map((match) => match[1].replace(/\/$/, ""))
}

describe("computer-use documentation paths", () => {
  for (const doc of docs) {
    test(`resolves source paths cited in ${doc}`, () => {
      const cited = citedPaths(readFileSync(join(repoRoot, doc), "utf8"))
      expect(cited.length).toBeGreaterThan(0)
      expect(cited.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([])
    })
  }

  test("rejects a missing cited path while retaining a real crate", () => {
    const cited = citedPaths("see `packages/desktop-nope/x.ts` and `crates/senpi-desktop-engine`")
    expect(cited.filter((path) => !existsSync(join(repoRoot, path)))).toEqual(["packages/desktop-nope/x.ts"])
  })
})
