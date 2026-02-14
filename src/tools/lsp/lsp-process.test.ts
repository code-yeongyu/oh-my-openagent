import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, spyOn } from "bun:test"

describe("spawnProcess", () => {
  it("proceeds to node spawn on Windows when command is available", async () => {
    //#given
    const originalPlatform = process.platform
    const rootDir = mkdtempSync(join(tmpdir(), "lsp-process-test-"))
    const childProcess = await import("node:child_process")
    const nodeSpawnSpy = spyOn(childProcess, "spawn")

    try {
      Object.defineProperty(process, "platform", { value: "win32" })
      const { spawnProcess } = await import("./lsp-process")

      //#when
      let result: ReturnType<typeof spawnProcess> | null = null
      expect(() => {
        result = spawnProcess(["node", "--version"], {
          cwd: rootDir,
          env: process.env,
        })
      }).not.toThrow(/Binary 'node' not found/)

      //#then
      expect(nodeSpawnSpy).toHaveBeenCalled()
      expect(result).not.toBeNull()
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform })
      nodeSpawnSpy.mockRestore()
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
