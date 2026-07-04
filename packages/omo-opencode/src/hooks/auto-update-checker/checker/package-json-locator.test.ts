import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findPackageJsonUp } from "./package-json-locator"

describe("findPackageJsonUp", () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "omo-pkg-locator-"))
  })

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  it("finds a package.json whose name is the canonical oh-my-opencode", () => {
    const pkgPath = join(workdir, "package.json")
    writeFileSync(pkgPath, JSON.stringify({ name: "oh-my-opencode", version: "3.16.0" }))

    const found = findPackageJsonUp(workdir)

    expect(found).toBe(pkgPath)
  })

  it("finds a package.json whose name is the aliased oh-my-openagent (GH-3257)", () => {
    // A user who installed `oh-my-openagent` from npm gets a node_modules entry
    // whose package.json has `name: "oh-my-openagent"`. The auto-update-checker
    // must still resolve it so the startup toast shows a real version instead
    // of "unknown".
    const pkgPath = join(workdir, "package.json")
    writeFileSync(pkgPath, JSON.stringify({ name: "oh-my-openagent", version: "3.16.0" }))

    const found = findPackageJsonUp(workdir)

    expect(found).toBe(pkgPath)
  })

  it("walks up directories to find the matching package.json", () => {
    const nested = join(workdir, "dist", "checker")
    mkdirSync(nested, { recursive: true })
    const pkgPath = join(workdir, "package.json")
    writeFileSync(pkgPath, JSON.stringify({ name: "oh-my-openagent", version: "3.16.0" }))

    const found = findPackageJsonUp(nested)

    expect(found).toBe(pkgPath)
  })

  it("ignores unrelated package.json files", () => {
    const pkgPath = join(workdir, "package.json")
    writeFileSync(pkgPath, JSON.stringify({ name: "some-other-package", version: "1.0.0" }))

    const found = findPackageJsonUp(workdir)

    expect(found).toBeNull()
  })

  it("returns null when no package.json exists", () => {
    const found = findPackageJsonUp(workdir)

    expect(found).toBeNull()
  })

  it("#given the interim @oh-my-opencode/omo-opencode manifest between the file and an accepted root #when walking up #then skips it and returns the accepted manifest", () => {
    const nested = join(workdir, "pkg", "nested")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "file.js"), "")
    writeFileSync(join(workdir, "pkg", "package.json"), JSON.stringify({ name: "@oh-my-opencode/omo-opencode", version: "0.1.0" }))
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "9.9.9" }))

    const found = findPackageJsonUp(join(nested, "file.js"))

    expect(found).toBe(join(workdir, "package.json"))
  })

  it("#given no accepted-name manifest within the 10-level-capped walk #when walking up #then returns null", () => {
    const nested = join(workdir, "a", "b", "c")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ name: "@oh-my-opencode/omo-opencode", version: "0.1.0" }))

    const found = findPackageJsonUp(nested)

    expect(found).toBeNull()
  })
})
