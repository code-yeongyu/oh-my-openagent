import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const ultraworkRoot = join(repoRoot, "packages/omo-codex/plugin/components/ultrawork")

describe("omo-codex Python migration regression", () => {
  it("keeps package scripts and plugin packaging Python-free", () => {
    // given
    const componentPackage = readJson(join(ultraworkRoot, "package.json"))
    const aggregateHooks = readFileSync(join(repoRoot, "packages/omo-codex/plugin/hooks/hooks.json"), "utf8")
    const componentHooks = readFileSync(join(ultraworkRoot, "hooks/hooks.json"), "utf8")
    const aggregateTest = readFileSync(join(repoRoot, "packages/omo-codex/plugin/test/aggregate.test.mjs"), "utf8")

    // when
    const packagedFiles = isRecord(componentPackage) && Array.isArray(componentPackage["files"])
      ? componentPackage["files"]
      : []
    const scripts = isRecord(componentPackage) && isRecord(componentPackage["scripts"]) ? componentPackage["scripts"] : {}
    const bin = isRecord(componentPackage) && isRecord(componentPackage["bin"]) ? componentPackage["bin"] : {}

    // then
    expect(scripts["build"]).toBe("tsc -p tsconfig.build.json")
    expect(scripts["test"]).toBe("vitest --run")
    expect(bin["omo-ultrawork"]).toBe("./dist/cli.js")
    expect(packagedFiles).toContain("dist")
    expect(packagedFiles).not.toContain("hooks/ultrawork-detector.py")
    expect(`${aggregateHooks}\n${componentHooks}\n${aggregateTest}`).not.toMatch(/\bpython3?\b|ultrawork-detector\.py/)
  })
})

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
