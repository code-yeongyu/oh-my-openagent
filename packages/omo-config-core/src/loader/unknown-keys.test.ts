import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOmoConfig } from "../index"

function makeFixture(): { readonly cwd: string; readonly homeDir: string; readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-unknown-keys-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, root }
}

function writeUserConfig(homeDir: string, content: string): void {
  writeFileSync(join(homeDir, ".omo", "omo.json"), content)
}

function loadSenpi(fixture: { readonly cwd: string; readonly homeDir: string }, profile?: string) {
  return loadOmoConfig({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir },
    harness: "senpi",
    platform: "linux",
    ...(profile === undefined ? {} : { profile }),
  })
}

describe("loadOmoConfig unknown-key tolerance", () => {
  test("#given a user layer with a valid category and a retired root key #when loading the senpi view #then the category loads and one unknown-keys diagnostic names the ignored key", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"categories":{"quick":{"model":"user-model"}},"retired_key":{}}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.config.categories?.quick?.model).toBe("user-model")
      expect(result.sources.map((source) => source.loaded)).toEqual([true])
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        kind: "unknown-keys",
        issuePaths: ["retired_key"],
        path: join(fixture.homeDir, ".omo", "omo.json"),
      })
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given retired keys nested in a profile and a senpi block #when loading the active profile #then both are stripped and the diagnostic carries dotted paths", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(
      fixture.homeDir,
      `{"profiles":{"opus":{"retired_key":{},"telemetry":{"enabled":false}}},"[senpi]":{"retired_key":{},"task":{"default_concurrency":3}}}`,
    )

    try {
      // when
      const result = loadSenpi(fixture, "opus")

      // then
      expect(result.profile).toBe("opus")
      expect(result.config.task?.default_concurrency).toBe(3)
      expect(result.config.telemetry?.enabled).toBe(false)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "unknown-keys" })
      expect(result.diagnostics[0]?.issuePaths).toEqual(["[senpi].retired_key", "profiles.opus.retired_key"])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a prototype-pollution key beside a valid block #when loading the senpi view #then the whole layer is rejected instead of stripped", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(
      fixture.homeDir,
      '{"__proto__":{"polluted":true},"categories":{"quick":{"model":"user-model"}}}',
    )

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.sources.map((source) => source.loaded)).toEqual([false])
      expect(result.config.categories?.quick).toBeUndefined()
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "validation" })
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined()
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a malformed known value #when loading the senpi view #then the layer is rejected with a validation diagnostic", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"categories":"nope"}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.sources.map((source) => source.loaded)).toEqual([false])
      expect(result.config.categories).toEqual({})
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "validation", issuePaths: ["categories"] })
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })
})
