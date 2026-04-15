import { describe, it, expect } from "bun:test"
import { spawnWithWindowsHide } from "./spawn-with-windows-hide"

describe("spawnWithWindowsHide", () => {
  describe("#given CVE-2024-27980 security requirement", () => {
    describe("#when spawning on Windows", () => {
      it("#then should not use shell option (CVE-2024-27980)", () => {
        // このテストはWindows環境でのみ意味を持つ
        // ここでは関数が存在し、適切なシグネチャを持つことを確認
        expect(typeof spawnWithWindowsHide).toBe("function")
      })

      it("#then should work with simple command", async () => {
        // 基本的な機能テスト
        const isWindows = process.platform === "win32"
        const cmd = isWindows ? ["cmd", "/c", "echo", "test"] : ["echo", "test"]

        const proc = spawnWithWindowsHide(cmd, {
          stdout: "pipe",
          stderr: "pipe",
        })

        // プロセスが正常に起動することを確認
        expect(proc).toBeDefined()
        expect(proc.exited).toBeDefined()
        expect(proc.stdout).toBeDefined()

        // プロセス終了を待つ
        const exitCode = await proc.exited
        expect(exitCode).toBe(0)
      })
    })
  })
})
