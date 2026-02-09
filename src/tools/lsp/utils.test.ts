import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import os from "os"

import { findWorkspaceRoot } from "./lsp-client-wrapper"

describe("lsp utils", () => {
  describe("findWorkspaceRoot", () => {
    it("returns an existing directory even when the file path points to a non-existent nested path", () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-lsp-root-"))
      try {
        // Add a marker so the function can discover the workspace root.
        writeFileSync(join(tmp, "package.json"), "{}")

        const nonExistentFile = join(tmp, "does-not-exist", "deep", "file.ts")
        const root = findWorkspaceRoot(nonExistentFile)

        expect(root).toBe(tmp)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("prefers the nearest marker directory when markers exist above the file", () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-lsp-marker-"))
      try {
        const repo = join(tmp, "repo")
        const src = join(repo, "src")
        mkdirSync(src, { recursive: true })

        writeFileSync(join(repo, "package.json"), "{}")
        const file = join(src, "index.ts")
        writeFileSync(file, "export {}")

        expect(findWorkspaceRoot(file)).toBe(repo)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })
})
