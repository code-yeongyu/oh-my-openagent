/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { fingerprintSource } from "./agent-command-string-scan"

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
})
