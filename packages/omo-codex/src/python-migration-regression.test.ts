import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const aggregatePluginRoot = join(repoRoot, "packages/omo-codex/plugin")

describe("omo-codex Python migration regression", () => {
  it("keeps aggregate plugin packaging Python-free", () => {
    // given
    const aggregatePackageText = readFileSync(join(aggregatePluginRoot, "package.json"), "utf8")
    const aggregatePackage = readJson(join(aggregatePluginRoot, "package.json"))
    const aggregateHooks = readFileSync(join(aggregatePluginRoot, "hooks/hooks.json"), "utf8")
    const aggregateTest = readFileSync(join(aggregatePluginRoot, "test/aggregate.test.mjs"), "utf8")

    // when
    const scripts = isRecord(aggregatePackage) && isRecord(aggregatePackage["scripts"]) ? aggregatePackage["scripts"] : {}
    const workspaces = isRecord(aggregatePackage) && Array.isArray(aggregatePackage["workspaces"])
      ? aggregatePackage["workspaces"]
      : []

    // then
    expect(scripts["build"]).toContain("node scripts/build-components.mjs")
    expect(scripts["test"]).toBe("node --test test/*.test.mjs")
    expect(workspaces).toContain("components/ultrawork")
    expect(`${aggregatePackageText}\n${aggregateHooks}\n${aggregateTest}`).not.toMatch(/\bpython3?\b|ultrawork-detector\.py/)
  })
})

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
