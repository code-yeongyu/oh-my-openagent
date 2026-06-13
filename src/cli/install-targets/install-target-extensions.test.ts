import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installTargetExtensions } from "./install-target-extensions"

let home = ""
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe("target extension installer", () => {
  it("#given target roots #when installed #then both manifests are linked without clobbering unrelated extensions", () => {
    home = mkdtempSync(join(tmpdir(), "omo-target-install-"))
    const packageRoot = join(home, "package")
    const results = installTargetExtensions({ home, packageRoot })

    expect(results.every((result) => result.installed)).toBe(true)
    expect(readlinkSync(results[0].path)).toBe(packageRoot)
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
})
