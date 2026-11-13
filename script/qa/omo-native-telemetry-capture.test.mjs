import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import { closeCaptureServer, startCaptureServer } from "./omo-native-telemetry-capture.mjs"

const captureRoots = () =>
  readdirSync(tmpdir())
    .filter((name) => name.startsWith("omo-native-telemetry-capture-"))
    .map((name) => join(tmpdir(), name))

describe("telemetry capture server temp-dir hygiene", () => {
  test("#given a started capture server #when it is closed #then the mkdtemp capture root no longer exists", async () => {
    const capture = await startCaptureServer()
    expect(existsSync(capture.root)).toBe(true)
    let rootExistsAfterClose = true
    try {
      const receipt = await closeCaptureServer(capture)
      expect(receipt.killZeroFails).toBe(true)
      expect(receipt.portFree).toBe(true)
      rootExistsAfterClose = existsSync(capture.root)
    } finally {
      if (existsSync(capture.root)) rmSync(capture.root, { recursive: true, force: true })
    }
    expect(rootExistsAfterClose).toBe(false)
  })

  test("#given a capture server whose child exits before startup #when startup rejects #then the capture root is removed", async () => {
    const before = new Set(captureRoots())
    const fakeBin = mkdtempSync(join(tmpdir(), "telemetry-capture-fakebun-"))
    const previousPath = process.env.PATH
    let leaked = []
    try {
      // win32 resolves the bare name through PATHEXT, so its fake is a batch file
      const fakeBun = join(fakeBin, process.platform === "win32" ? "bun.cmd" : "bun")
      writeFileSync(fakeBun, process.platform === "win32" ? "@exit /b 42\r\n" : "#!/bin/sh\nexit 42\n")
      chmodSync(fakeBun, 0o755)
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ""}`
      await expect(startCaptureServer()).rejects.toThrow()
    } finally {
      process.env.PATH = previousPath
      leaked = captureRoots().filter((root) => !before.has(root))
      for (const root of leaked) rmSync(root, { recursive: true, force: true })
      rmSync(fakeBin, { recursive: true, force: true })
    }
    expect(leaked).toEqual([])
  })
})
