import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runtimeScriptsDir, syncRuntime } from "../lib/system.mjs"

let root: string
let source: string
let stateDir: string

function shipScripts(version: string) {
  rmSync(source, { recursive: true, force: true })
  mkdirSync(join(source, "lib"), { recursive: true })
  mkdirSync(join(source, "tests"))
  writeFileSync(join(source, "omomeow.mjs"), `// ${version}\nimport "./lib/x.mjs"\n`)
  writeFileSync(join(source, "lib", "x.mjs"), `export const version = "${version}"\n`)
  writeFileSync(join(source, "tests", "x.test.ts"), "")
}

function entry() {
  return readFileSync(join(runtimeScriptsDir(stateDir), "omomeow.mjs"), "utf8")
}

function versions() {
  return readdirSync(join(stateDir, "runtime")).filter((name) => name.startsWith("scripts-")).length
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omomeow-runtime-"))
  source = join(root, "skill-scripts")
  stateDir = join(root, "state")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("syncRuntime", () => {
  test("#given new shipped scripts #when synced #then the runtime entry point switches and tests are left out", () => {
    shipScripts("a")
    expect(syncRuntime(stateDir, { source }).changed).toBe(true)
    expect(syncRuntime(stateDir, { source }).changed).toBe(false)

    shipScripts("b")
    const result = syncRuntime(stateDir, { source })

    expect(result.changed).toBe(true)
    expect(entry()).toContain("// b")
    expect(readdirSync(runtimeScriptsDir(stateDir)).sort()).toEqual(["lib", "omomeow.mjs"])
  })

  test("#given three refreshes #when synced #then only the current and the previous version are kept", () => {
    for (const version of ["a", "b", "c"]) {
      shipScripts(version)
      syncRuntime(stateDir, { source })
    }

    expect(entry()).toContain("// c")
    expect(versions()).toBe(2)
  })

  test("#given the copy fails halfway #when synced #then it throws and the service keeps the previous runtime", () => {
    shipScripts("a")
    syncRuntime(stateDir, { source })
    shipScripts("b")
    const failingCopy = (from: string, to: string) => {
      mkdirSync(to, { recursive: true })
      cpSync(join(from, "omomeow.mjs"), join(to, "omomeow.mjs"))
      throw new Error("ENOSPC: no space left on device")
    }

    expect(() => syncRuntime(stateDir, { source, copy: failingCopy })).toThrow("ENOSPC")
    expect(entry()).toContain("// a")
    expect(readFileSync(join(runtimeScriptsDir(stateDir), "lib", "x.mjs"), "utf8")).toContain('"a"')
    expect(versions()).toBe(1)
  })
})
