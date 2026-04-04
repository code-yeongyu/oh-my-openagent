import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import os from "os"

import { inferExtensionFromDirectory } from "./infer-extension"

describe("inferExtensionFromDirectory", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "omo-infer-ext-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("#given a directory with TypeScript files", () => {
    beforeEach(() => {
      writeFileSync(join(tmpDir, "index.ts"), "export const a = 1")
      writeFileSync(join(tmpDir, "utils.ts"), "export const b = 2")
      writeFileSync(join(tmpDir, "app.tsx"), "export const c = 3")
    })

    describe("#when inferring extension", () => {
      it("#then returns .ts as the most common extension", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBe(".ts")
      })
    })
  })

  describe("#given a directory with mixed file types where Python dominates", () => {
    beforeEach(() => {
      writeFileSync(join(tmpDir, "main.py"), "x = 1")
      writeFileSync(join(tmpDir, "utils.py"), "y = 2")
      writeFileSync(join(tmpDir, "helper.py"), "z = 3")
      writeFileSync(join(tmpDir, "config.ts"), "export default {}")
    })

    describe("#when inferring extension", () => {
      it("#then returns .py as the most common extension", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBe(".py")
      })
    })
  })

  describe("#given an empty directory", () => {
    describe("#when inferring extension", () => {
      it("#then returns null", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBeNull()
      })
    })
  })

  describe("#given a directory with only unsupported files", () => {
    beforeEach(() => {
      writeFileSync(join(tmpDir, "data.csv"), "a,b,c")
      writeFileSync(join(tmpDir, "image.png"), "fake")
    })

    describe("#when inferring extension", () => {
      it("#then returns null", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBeNull()
      })
    })
  })

  describe("#given a directory with nested subdirectories", () => {
    beforeEach(() => {
      writeFileSync(join(tmpDir, "root.go"), "package main")
      const sub = join(tmpDir, "pkg")
      mkdirSync(sub)
      writeFileSync(join(sub, "handler.go"), "package pkg")
      writeFileSync(join(sub, "model.go"), "package pkg")
    })

    describe("#when inferring extension", () => {
      it("#then counts files recursively", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBe(".go")
      })
    })
  })

  describe("#given a directory with node_modules", () => {
    beforeEach(() => {
      writeFileSync(join(tmpDir, "index.ts"), "export {}")
      const nm = join(tmpDir, "node_modules", "pkg")
      mkdirSync(nm, { recursive: true })
      writeFileSync(join(nm, "a.js"), "module.exports = {}")
      writeFileSync(join(nm, "b.js"), "module.exports = {}")
      writeFileSync(join(nm, "c.js"), "module.exports = {}")
    })

    describe("#when inferring extension", () => {
      it("#then skips node_modules and returns .ts", () => {
        const result = inferExtensionFromDirectory(tmpDir)
        expect(result).toBe(".ts")
      })
    })
  })
})
