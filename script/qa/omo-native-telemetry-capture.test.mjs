import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import { closeCaptureServer, startCaptureServer } from "./omo-native-telemetry-capture.mjs"
import { removeTempRoot } from "../remove-temp-root.ts"

const captureRoots = () =>
  readdirSync(tmpdir())
    .filter((name) => name.startsWith("omo-native-telemetry-capture-"))
    .map((name) => join(tmpdir(), name))

const tempRoots = []
// A timed-out or aborted test never reaches its finally block, so every capture root and fake-bin
// root is registered the moment it exists and removed here on every path (#9766, #11564).
afterEach(() => {
  for (const root of tempRoots.splice(0)) if (existsSync(root)) removeTempRoot(root)
})

describe("telemetry capture server temp-dir hygiene", () => {
  test("#given a started capture server #when it is closed #then the mkdtemp capture root no longer exists", async () => {
    const capture = await startCaptureServer()
    tempRoots.push(capture.root)
    expect(existsSync(capture.root)).toBe(true)
    const receipt = await closeCaptureServer(capture)
    expect(receipt.killZeroFails).toBe(true)
    expect(receipt.portFree).toBe(true)
    expect(existsSync(capture.root)).toBe(false)
  })

  test("#given a capture server whose child exits before startup #when startup rejects #then the capture root is removed", async () => {
    const before = new Set(captureRoots())
    const fakeBin = mkdtempSync(join(tmpdir(), "telemetry-capture-fakebun-"))
    tempRoots.push(fakeBin)
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
