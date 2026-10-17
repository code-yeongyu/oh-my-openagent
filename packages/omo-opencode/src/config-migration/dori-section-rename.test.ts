import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { parse } from "jsonc-parser"
import { loadOmoConfig, runMigrations } from "@oh-my-opencode/omo-config-core"
import { createLegacyConfigMigrationPlans, executeLegacyConfigMigrationPlan } from "./index"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(document: Record<string, unknown>, legacyFiles: Readonly<Record<string, string>> = {}) {
  const homeDir = realpathSync.native(mkdtempSync(join(tmpdir(), "dori-migration-")))
  roots.push(homeDir)
  const cwd = join(homeDir, "project")
  const targetPath = join(homeDir, ".omo", "omo.jsonc")
  mkdirSync(join(homeDir, ".omo"))
  mkdirSync(cwd)
  writeFileSync(targetPath, `// keep this comment\n${JSON.stringify(document, null, 2)}\n`)
  for (const [relativePath, content] of Object.entries(legacyFiles)) {
    const path = join(homeDir, relativePath)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }
  const plans = createLegacyConfigMigrationPlans({
    cwd, homeDir, environment: { HOME: homeDir }, pathOperations: posix, platform: "linux",
  })
  const plan = plans.find((candidate) => candidate.id === "2026-10-dori-section-rename" && candidate.targetPath === targetPath)
  if (plan === undefined) throw new Error("Dori section migration was not registered")
  return { homeDir, cwd, targetPath, plan, plans }
}

describe("gateway to dori config migration", () => {
  test.each([
    {
      name: "gateway target plus a legacy OpenCode config",
      document: { gateway: { scopes: [{ id: "local" }] } },
      legacy: { ".config/opencode/oh-my-openagent.json": '{"agents":{"finder":{"model":"provider/finder"}}}' },
      dori: { scopes: [{ id: "local" }] },
    },
    {
      name: "gateway and dori target plus a legacy OpenCode config",
      document: { gateway: { a: 1 }, dori: { b: 2 } },
      legacy: { ".config/opencode/oh-my-openagent.json": '{"agents":{"finder":{"model":"provider/finder"}}}' },
      dori: { b: 2 },
    },
    {
      name: "gateway target plus a legacy codex config.jsonc",
      document: { gateway: { a: 1 } },
      legacy: { ".omo/config.jsonc": '{"[opencode]":{"disabled_hooks":["startup-toast"]}}' },
      dori: { a: 1 },
    },
  ])("#given $name #when the startup batch runs #then the rename precedes strict target validation by the legacy plans", ({ document, legacy, dori }) => {
    const f = fixture(document, legacy)
    const result = runMigrations({ env: { HOME: f.homeDir }, discover: () => f.plans })
    expect(result.status).toBe("completed")
    const loaded = loadOmoConfig({ cwd: f.cwd, env: { HOME: f.homeDir } })
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.config.dori).toEqual(dori)
    expect(Object.hasOwn(parse(readFileSync(f.targetPath, "utf8")), "gateway")).toBe(false)
  })

  test("#given legacy sections in every config container #when migrating twice #then values and comments survive and the second run writes nothing", () => {
    const section = { gateway: { userData: true }, scopes: [{ id: "local" }] }
    const document = {
      gateway: section,
      "[native]": { gateway: section },
      "[senpi]": { gateway: section },
      "[codex]": { gateway: section },
      "[opencode]": { gateway: section },
      profiles: { work: { gateway: section, "[native]": { gateway: section } } },
    }
    const f = fixture(document)
    const first = executeLegacyConfigMigrationPlan(f.plan, { env: { HOME: f.homeDir } })
    const afterFirst = readFileSync(f.targetPath, "utf8")
    const second = executeLegacyConfigMigrationPlan(f.plan, { env: { HOME: f.homeDir } })

    expect(first.status).toBe("migrated")
    expect(second.status).toBe("skipped")
    expect(readFileSync(f.targetPath, "utf8")).toBe(afterFirst)
    expect(afterFirst).toContain("// keep this comment")
    expect(parse(afterFirst)).toEqual({
      dori: section,
      "[native]": { dori: section },
      "[senpi]": { dori: section },
      "[codex]": { dori: section },
      "[opencode]": { dori: section },
      profiles: { work: { dori: section, "[native]": { dori: section } } },
      _migrations: ["2026-10-dori-section-rename"],
    })
    const loaded = loadOmoConfig({ cwd: f.cwd, env: { HOME: f.homeDir }, harness: "native", profile: "work" })
    expect(loaded.config.dori).toEqual(section)
    expect(loaded.config).not.toHaveProperty("gateway")
    expect(document.gateway).toEqual(section)
  })

  test("#given canonical and legacy sections #when migrating #then canonical values win without merging opaque data", () => {
    const f = fixture({ gateway: { legacy: true }, dori: { current: true } })
    const before = readFileSync(f.targetPath, "utf8")
    const result = executeLegacyConfigMigrationPlan(f.plan, { env: { HOME: f.homeDir } })
    expect(result.status).toBe("migrated")
    expect(parse(readFileSync(f.targetPath, "utf8"))).toEqual({
      dori: { current: true }, _migrations: ["2026-10-dori-section-rename"],
    })
    // the dropped gateway section stays recoverable from the engine's pre-write backup of the target
    expect(result.targetBackupPath).toStartWith(`${f.targetPath}.bak.`)
    expect(readFileSync(result.targetBackupPath ?? "", "utf8")).toBe(before)
    expect(parse(readFileSync(result.targetBackupPath ?? "", "utf8")).gateway).toEqual({ legacy: true })
  })

  test("#given no legacy section #when migrating #then no backup marker or write occurs", () => {
    const f = fixture({ dori: { gateway: { opaque: true } } })
    const before = readFileSync(f.targetPath, "utf8")
    expect(executeLegacyConfigMigrationPlan(f.plan, { env: { HOME: f.homeDir } }).status).toBe("skipped")
    expect(readFileSync(f.targetPath, "utf8")).toBe(before)
  })
})
