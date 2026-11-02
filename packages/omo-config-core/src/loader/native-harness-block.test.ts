import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOmoConfig } from "../index"

function makeFixture(config: string): { readonly cwd: string; readonly homeDir: string; readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-native-harness-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(homeDir, ".omo", "omo.jsonc"), config)
  return { cwd, homeDir, root }
}

describe("the [native] harness block", () => {
  test("#given a config whose harness block is spelled [native] #when loading the native view #then its values are applied", () => {
    // given
    const fixture = makeFixture(`{
      "categories": { "quick": { "model": "base/model" } },
      "[native]": {
        "categories": { "quick": { "model": "native/model" } },
        "model_profile": "native-profile"
      }
    }`)

    try {
      // when
      const result = loadOmoConfig({
        cwd: fixture.cwd,
        env: { HOME: fixture.homeDir },
        harness: "native",
        platform: "linux",
      })

      // then
      expect(result.diagnostics).toEqual([])
      expect(result.config.categories?.quick?.model).toBe("native/model")
      expect(result.config.model_profile).toBe("native-profile")
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a config still spelled [senpi] #when loading the native view #then every value survives and the legacy key is reported", () => {
    // given
    const fixture = makeFixture(`{
      "categories": { "quick": { "model": "base/model" } },
      "[senpi]": {
        "categories": { "quick": { "model": "legacy/model", "reasoningEffort": "high" } },
        "git_master": { "commit_footer": true },
        "telemetry": { "enabled": false },
        "model_profile": "legacy-profile"
      }
    }`)

    try {
      // when
      const result = loadOmoConfig({
        cwd: fixture.cwd,
        env: { HOME: fixture.homeDir },
        harness: "native",
        platform: "linux",
      })

      // then — no value is lost
      expect(result.config.categories?.quick?.model).toBe("legacy/model")
      expect(result.config.categories?.quick?.reasoning).toBe("high")
      expect(result.config.git_master?.commit_footer).toBe(true)
      expect(result.config.telemetry?.enabled).toBe(false)
      expect(result.config.model_profile).toBe("legacy-profile")
      // then — the legacy spelling is reported by name so the user can rename it
      expect(result.diagnostics.map(({ kind, issuePaths }) => ({ kind, issuePaths }))).toEqual([
        { kind: "deprecated-keys", issuePaths: ["[senpi]"] },
      ])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a config carrying both [native] and [senpi] #when loading #then [native] wins and the dropped legacy block is reported", () => {
    // given
    const fixture = makeFixture(`{
      "[native]": { "model_profile": "canonical" },
      "[senpi]": { "model_profile": "legacy" }
    }`)

    try {
      // when
      const result = loadOmoConfig({
        cwd: fixture.cwd,
        env: { HOME: fixture.homeDir },
        harness: "native",
        platform: "linux",
      })

      // then
      expect(result.config.model_profile).toBe("canonical")
      expect(result.diagnostics.map(({ kind, issuePaths }) => ({ kind, issuePaths }))).toEqual([
        { kind: "deprecated-keys", issuePaths: ["[senpi]"] },
      ])
      expect(result.diagnostics[0]?.message).toContain("[native]")
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a caller still asking for the senpi harness #when loading #then the [native] block is applied to it", () => {
    // given
    const fixture = makeFixture(`{
      "[native]": { "model_profile": "native-profile" }
    }`)

    try {
      // when
      const result = loadOmoConfig({
        cwd: fixture.cwd,
        env: { HOME: fixture.homeDir },
        harness: "senpi",
        platform: "linux",
      })

      // then
      expect(result.config.model_profile).toBe("native-profile")
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })
})
