import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"

import { digestDirectory, listFiles } from "./directory-digest.mjs"

describe("directory digest traversal", () => {
  test("terminates deterministically when a directory link points to an ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-directory-digest-"))
    const nested = join(root, "nested")
    mkdirSync(nested)
    writeFileSync(join(nested, "content.txt"), "stable\n")
    symlinkSync(root, join(nested, "ancestor"), process.platform === "win32" ? "junction" : "dir")

    try {
      const first = digestDirectory(root)
      expect(first).toHaveLength(64)
      expect(digestDirectory(root)).toBe(first)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("collects a directory wider than the JavaScript argument limit", () => {
    const fixture = fileURLToPath(new URL("./fixtures/directory-digest-wide.mjs", import.meta.url))
    const result = spawnSync("node", [fixture], { encoding: "utf-8" })

    expect(result.status, result.stderr).toBe(0)
  })

  test("does not revisit two directory paths with the same filesystem identity", () => {
    let reads = 0
    const operations = {
      realpathSync: () => "same-directory",
      readdirSync() {
        reads += 1
        if (reads > 4) throw new Error("directory identity was revisited")
        return [directoryEntry("alias")]
      },
    }

    expect(listFiles("root", operations)).toEqual([])
    expect(reads).toBe(1)
  })

  test("excludes explicitly volatile root entries from the digest", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-directory-ignore-"))
    const stable = join(root, "stable")
    const volatile = join(root, "volatile")
    mkdirSync(stable)
    mkdirSync(volatile)
    writeFileSync(join(stable, "config.json"), "stable\n")
    writeFileSync(join(volatile, "session.jsonl"), "first\n")

    try {
      const before = digestDirectory(root, { ignore: ["volatile"] })
      writeFileSync(join(volatile, "session.jsonl"), "second\n")
      expect(digestDirectory(root, { ignore: ["volatile"] })).toBe(before)
      writeFileSync(join(stable, "config.json"), "changed\n")
      expect(digestDirectory(root, { ignore: ["volatile"] })).not.toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function directoryEntry(name) {
  return { name, isDirectory: () => true, isFile: () => false }
}
