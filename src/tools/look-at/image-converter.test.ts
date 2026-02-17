import { describe, expect, test, mock, beforeEach } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const originalChildProcess = await import("node:child_process")

const execFileSyncMock = mock((_command: string, _args: string[]) => "")
const execSyncMock = mock(() => {
  throw new Error("execSync should not be called")
})

mock.module("node:child_process", () => ({
  ...originalChildProcess,
  execFileSync: execFileSyncMock,
  execSync: execSyncMock,
}))

const { convertImageToJpeg } = await import("./image-converter")

describe("image-converter command execution safety", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
    execSyncMock.mockReset()
  })

  test("uses execFileSync with argument arrays for conversion commands", () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-test-"))
    const inputPath = join(testDir, "evil$(touch_pwn).heic")
    writeFileSync(inputPath, "fake-heic-data")

    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "sips") {
        const outIndex = args.indexOf("--out")
        const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined
        if (outputPath) writeFileSync(outputPath, "jpeg")
      } else if (command === "convert") {
        writeFileSync(args[1], "jpeg")
      }
      return ""
    })

    const outputPath = convertImageToJpeg(inputPath, "image/heic")

    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).toHaveBeenCalled()

    const [firstCommand, firstArgs] = execFileSyncMock.mock.calls[0] as [string, string[]]
    expect(typeof firstCommand).toBe("string")
    expect(Array.isArray(firstArgs)).toBe(true)
    expect(firstArgs).toContain(inputPath)
    expect(firstArgs.join(" ")).not.toContain(`\"${inputPath}\"`)

    expect(existsSync(outputPath)).toBe(true)

    if (existsSync(outputPath)) unlinkSync(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })
})
