import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { LoadedSkill } from "./types"

const TEST_DIR = join(tmpdir(), "async-loader-test-" + Date.now())
const SKILLS_DIR = join(TEST_DIR, ".opencode", "skills")

function createTestSkill(name: string, content: string, mcpJson?: object): string {
  const skillDir = join(SKILLS_DIR, name)
  mkdirSync(skillDir, { recursive: true })
  const skillPath = join(skillDir, "SKILL.md")
  writeFileSync(skillPath, content)
  if (mcpJson) {
    writeFileSync(join(skillDir, "mcp.json"), JSON.stringify(mcpJson, null, 2))
  }
  return skillDir
}

function createDirectSkill(name: string, content: string): string {
  mkdirSync(SKILLS_DIR, { recursive: true })
  const skillPath = join(SKILLS_DIR, `${name}.md`)
  writeFileSync(skillPath, content)
  return skillPath
}

describe("async-loader", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("mapWithConcurrency", () => {
    it("processes items with concurrency limit", async () => {
      // given
      const { mapWithConcurrency } = await import("./async-loader")
      const items = Array.from({ length: 50 }, (_, i) => i)
      let maxConcurrent = 0
      let currentConcurrent = 0

      const mapper = async (item: number) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise(resolve => setTimeout(resolve, 10))
        currentConcurrent--
        return item * 2
      }

      // when
      const results = await mapWithConcurrency(items, mapper, 16)

      // then
      expect(results).toEqual(items.map(i => i * 2))
      expect(maxConcurrent).toBeLessThanOrEqual(16)
      expect(maxConcurrent).toBeGreaterThan(1) // Should actually run concurrently
    })

    it("handles empty array", async () => {
      // given
      const { mapWithConcurrency } = await import("./async-loader")

      // when
      const results = await mapWithConcurrency([], async (x: number) => x * 2, 16)

      // then
      expect(results).toEqual([])
    })

    it("handles single item", async () => {
      // given
      const { mapWithConcurrency } = await import("./async-loader")

      // when
      const results = await mapWithConcurrency([42], async (x: number) => x * 2, 16)

      // then
      expect(results).toEqual([84])
    })
  })
})
