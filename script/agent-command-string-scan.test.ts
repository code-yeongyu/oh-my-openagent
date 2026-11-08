/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { collectHits, fingerprintSource, isExcluded } from "./agent-command-string-scan"

describe("agent command string scan", () => {
  describe("#given a tracked file whose lines shift", () => {
    const source = ["# title", "", "run `omo doctor` to diagnose", ""].join("\n")
    const shifted = ["# title", "", "new paragraph inserted by a docs or release commit", "", "run `omo doctor` to diagnose", ""].join("\n")

    test("#when a release version stamp or doc edit inserts lines above the hit #then the fingerprint is unchanged", () => {
      expect(fingerprintSource("AGENTS.md", shifted)).toEqual(fingerprintSource("AGENTS.md", source))
    })
  })

  describe("#given repeated occurrences in one file", () => {
    test("#when a new occurrence of an already-allowlisted command appears #then the fingerprint changes", () => {
      const before = fingerprintSource("script/x.test.ts", "omo install\nomo install\n")
      const after = fingerprintSource("script/x.test.ts", "omo install\nomo install\nomo install\n")
      expect(before).toEqual(["script/x.test.ts: omo install x2"])
      expect(after).not.toEqual(before)
    })
  })

  describe("#given a legacy agent command in a brand new file", () => {
    test("#when the file is scanned #then the hit is reported for that path", () => {
      expect(fingerprintSource("packages/new/thing.ts", "spawn omo ulw-loop now\n")).toEqual([
        "packages/new/thing.ts: omo ulw-loop",
      ])
    })
  })

  describe("#given a release tree where the stamp folds changes/unreleased fragments into CHANGELOG.md", () => {
    test("#when a tracked fragment names a legacy command #then the scan reports no hit for it, like CHANGELOG.md", () => {
      const root = mkdtempSync(join(tmpdir(), "agent-command-scan-"))
      try {
        mkdirSync(join(root, "changes/unreleased"), { recursive: true })
        writeFileSync(join(root, "changes/unreleased/11370.md"), "- `omo run` now uses a per-run password\n")
        writeFileSync(join(root, "guide.md"), "run `omo doctor`\n")
        for (const args of [["init", "-q"], ["add", "."]]) {
          expect(Bun.spawnSync(["git", ...args], { cwd: root }).exitCode).toBe(0)
        }
        expect(isExcluded("changes/unreleased/11370.md")).toBe(true)
        expect(collectHits(root)).toEqual(["guide.md: omo doctor"])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    test("#when the fold moves a fragment naming a legacy command into a root or package changes.md #then the hits are unchanged (#12609)", () => {
      const root = mkdtempSync(join(tmpdir(), "agent-command-scan-"))
      const git = (...args: string[]) => expect(Bun.spawnSync(["git", ...args], { cwd: root }).exitCode).toBe(0)
      try {
        // given: a tracked fragment and the logs it folds into
        mkdirSync(join(root, "changes/unreleased"), { recursive: true })
        mkdirSync(join(root, "packages/omo-native"), { recursive: true })
        const entry = "## 2026-11-06 - Doctor names the wrapper\n\n`omo doctor` now reports it.\n"
        writeFileSync(join(root, "changes/unreleased/12534.md"), `${entry}<!-- changes-log: packages/omo-native/changes.md -->\n`)
        writeFileSync(join(root, "changes.md"), "")
        writeFileSync(join(root, "packages/omo-native/changes.md"), "")
        writeFileSync(join(root, "guide.md"), "run `omo doctor`\n")
        git("init", "-q")
        git("add", ".")
        const before = collectHits(root)

        // when: the release stamp prepends the entry to both logs and deletes the fragment
        writeFileSync(join(root, "changes.md"), entry)
        writeFileSync(join(root, "packages/omo-native/changes.md"), entry)
        rmSync(join(root, "changes/unreleased/12534.md"))
        git("add", "-A")

        // then
        expect(collectHits(root)).toEqual(before)
        expect(before).toEqual(["guide.md: omo doctor"])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
