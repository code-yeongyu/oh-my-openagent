import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installTargetExtensions } from "./install-target-extensions"

let home = ""
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe("target extension installer", () => {
  it("#given target roots #when installed #then both manifests are real wrapper directories", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const packageRoot = join(home, "package")
    const results = installTargetExtensions({ home, packageRoot })

    expect(results.every((result) => result.installed)).toBe(true)
    expect(lstatSync(results[0].path).isDirectory()).toBe(true)
    expect(lstatSync(results[0].path).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(results[0].path, "index.js"), "utf8")).toContain("dist/hosts/oh-my-pi/index.js")
    expect(readFileSync(join(results[1].path, "index.js"), "utf8")).toContain("dist/hosts/pi/index.js")
  })

  it("#given an existing conflicting extension #when installed #then it remains untouched", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const path = join(home, ".pi", "agent", "extensions", "oh-my-openagent")
    mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true })
    writeFileSync(path, "existing")

    const [result] = installTargetExtensions({ home, packageRoot: join(home, "package"), targets: ["pi"] })

    expect(result.installed).toBe(false)
    expect(result.conflict).toContain("untouched")
  })

  it("#given one selected harness #when installed #then the other harness root remains untouched", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const [result] = installTargetExtensions({
      home,
      packageRoot: join(home, "package"),
      targets: ["pi"],
    })

    expect(result.target).toBe("pi")
    expect(result.installed).toBe(true)
    expect(existsSync(join(home, ".omp"))).toBe(false)
  })

  it("#given an old self-owned symlink install #when installed #then it is replaced with a wrapper directory", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const packageRoot = join(home, "package")
    const path = join(home, ".omp", "agent", "extensions", "oh-my-openagent")
    mkdirSync(join(home, ".omp", "agent", "extensions"), { recursive: true })
    symlinkSync(packageRoot, path, "dir")

    const [result] = installTargetExtensions({ home, packageRoot, targets: ["oh-my-pi"] })

    expect(result.installed).toBe(true)
    expect(lstatSync(path).isDirectory()).toBe(true)
    expect(lstatSync(path).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(path, "package.json"), "utf8")).toContain('"omp"')
  })

  it("#given a self-owned duplicate dev extension #when installed #then the duplicate is removed", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const packageRoot = join(home, "package")
    const devPath = join(home, ".pi", "agent", "extensions", "oh-my-openagent-dev")
    mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true })
    symlinkSync(packageRoot, devPath, "dir")

    const [result] = installTargetExtensions({ home, packageRoot, targets: ["pi"] })

    expect(result.installed).toBe(true)
    expect(result.removedDuplicates).toEqual([devPath])
    expect(existsSync(devPath)).toBe(false)
  })

  it("#given an unknown duplicate OMO extension #when installed #then it reports a conflict", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const devPath = join(home, ".pi", "agent", "extensions", "oh-my-openagent-dev")
    mkdirSync(join(home, ".pi", "agent", "extensions", "oh-my-openagent-dev"), { recursive: true })
    writeFileSync(join(devPath, "index.js"), "export default () => {}")

    const [result] = installTargetExtensions({ home, packageRoot: join(home, "package"), targets: ["pi"] })

    expect(result.installed).toBe(false)
    expect(result.conflict).toContain("Duplicate OMO extension path")
    expect(existsSync(devPath)).toBe(true)
  })
})
