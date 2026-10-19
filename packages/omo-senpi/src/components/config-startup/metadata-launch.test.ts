import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createConfigStartupComponent, runSenpiStartupMigration } from "./index"

// Migration contract (#10428): the OpenCode config migration runs at the first session, never on a
// launch that only prints help, a model list or the tips, although senpi loads extensions for those.
const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

const context: ComponentContext = {
  config: { getFlag: () => undefined },
  logger: { error() {}, info() {}, warn() {} },
}

const plugin = ["--extension", "/omo/plugin"]

describe("config-startup migration gate", () => {
  test.each([
    { argv: [...plugin, "--help"], migrates: false },
    { argv: [...plugin, "-h"], migrates: false },
    { argv: [...plugin, "--list-models", "gpt"], migrates: false },
    { argv: [...plugin, "--list-tips"], migrates: false },
    { argv: [...plugin, "config", "--help"], migrates: false },
    { argv: [...plugin, "-p", "hi", "--help"], migrates: false },
    { argv: [...plugin], migrates: true },
    { argv: [...plugin, "-p", "hi", "--", "--help"], migrates: true },
    { argv: [...plugin, "-p", "hi", "--name", "-h"], migrates: true },
    { argv: [...plugin, "--append-system-prompt", "--help"], migrates: true },
    { argv: [...plugin, "--mode", "rpc", "--multi-session", "--help"], migrates: true },
  ])("#given a legacy OpenCode config on disk #when the extension registers for $argv #then it is moved only when a session can start ($migrates)", ({ argv, migrates }) => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-metadata-launch-"))
    homes.push(home)
    const legacyPath = join(home, ".config", "opencode", "oh-my-openagent.json")
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(legacyPath, '{"agents":{"oracle":{"model":"openai/gpt-5.5"}}}\n')
    const past = new Date("2026-01-02T03:04:05Z")
    utimesSync(legacyPath, past, past)
    const bytes = readFileSync(legacyPath)
    const environment = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") }
    const component = createConfigStartupComponent({
      argv,
      loadConfig: () => ({ config: {}, diagnostics: [], layers: [], sources: [] }),
      resolveCwd: () => home,
      runMigration: ({ cwd }) => runSenpiStartupMigration({ cwd, environment, homeDir: home }),
    })

    // when
    component.register(new FakeExtensionAPI(), context)

    // then
    expect(existsSync(join(home, ".omo", "omo.jsonc"))).toBe(migrates)
    if (migrates) {
      expect(existsSync(legacyPath)).toBe(false)
      return
    }
    expect(readFileSync(legacyPath)).toEqual(bytes)
    expect(statSync(legacyPath).mtime.toISOString()).toBe(past.toISOString())
    expect(existsSync(join(home, ".omo"))).toBe(false)
  })
})
