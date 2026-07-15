import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureCodegraphProjectConfig } from "./codegraph/project-config"

describe("ensureCodegraphProjectConfig", () => {
  it("writes exclude patterns into codegraph.json when configured", () => {
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-project-config-"))

    try {
      const changed = ensureCodegraphProjectConfig(workspace, {
        exclude: ["pixie/", "bcc/", "opencode/"],
      })

      expect(changed).toBe(true)
      expect(JSON.parse(readFileSync(join(workspace, "codegraph.json"), "utf8"))).toEqual({
        exclude: ["pixie/", "bcc/", "opencode/"],
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("merges configured exclude patterns with existing project config", () => {
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-project-config-merge-"))
    const configPath = join(workspace, "codegraph.json")

    try {
      writeFileSync(configPath, `${JSON.stringify({ exclude: ["signoz/"], watch: true }, null, 2)}\n`, "utf8")

      const changed = ensureCodegraphProjectConfig(workspace, {
        exclude: ["pixie/", "signoz/"],
      })

      expect(changed).toBe(true)
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
        exclude: ["signoz/", "pixie/"],
        watch: true,
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("returns false when no exclude patterns are configured", () => {
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-project-config-empty-"))

    try {
      const changed = ensureCodegraphProjectConfig(workspace, { exclude: [] })

      expect(changed).toBe(false)
      expect(existsSync(join(workspace, "codegraph.json"))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("returns false when the merged config is unchanged", () => {
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-project-config-stable-"))
    const configPath = join(workspace, "codegraph.json")

    try {
      writeFileSync(configPath, `${JSON.stringify({ exclude: ["pixie/"] }, null, 2)}\n`, "utf8")

      const changed = ensureCodegraphProjectConfig(workspace, { exclude: ["pixie/"] })

      expect(changed).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
