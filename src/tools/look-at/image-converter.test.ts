import { describe, expect, test, mock, beforeEach } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const originalChildProcess = await import("node:child_process")

const execFileSyncMock = mock((_command: string, _args: string[], _options?: unknown) => "")
const execSyncMock = mock(() => {
  throw new Error("execSync should not be called")
})

mock.module("node:child_process", () => ({
  ...originalChildProcess,
  execFileSync: execFileSyncMock,
  execSync: execSyncMock,
}))

const { convertImageToJpeg, cleanupConvertedImage } = await import("./image-converter")

function writeConvertedOutput(command: string, args: string[]): void {
  if (command === "sips") {
    const outIndex = args.indexOf("--out")
    const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined
    if (outputPath) {
      writeFileSync(outputPath, "jpeg")
    }
    return
  }

  if (command === "convert") {
    writeFileSync(args[2], "jpeg")
    return
  }

  if (command === "magick") {
    writeFileSync(args[2], "jpeg")
  }
}

function withMockPlatform<TValue>(platform: NodeJS.Platform, run: () => TValue): TValue {
  const originalPlatform = process.platform
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })

  try {
    return run()
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    })
  }
}

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
      writeConvertedOutput(command, args)
      return ""
    })

    const outputPath = convertImageToJpeg(inputPath, "image/heic")

    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).toHaveBeenCalled()

    const [firstCommand, firstArgs] = execFileSyncMock.mock.calls[0] as [string, string[]]
    expect(typeof firstCommand).toBe("string")
    expect(Array.isArray(firstArgs)).toBe(true)
    expect(["sips", "convert", "magick"]).toContain(firstCommand)
    expect(firstArgs).toContain("--")
    expect(firstArgs).toContain(inputPath)
    expect(firstArgs.indexOf("--") < firstArgs.indexOf(inputPath)).toBe(true)
    expect(firstArgs.join(" ")).not.toContain(`\"${inputPath}\"`)

    expect(existsSync(outputPath)).toBe(true)

    if (existsSync(outputPath)) unlinkSync(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("removes temporary conversion directory during cleanup", () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-cleanup-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")

    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      writeConvertedOutput(command, args)
      return ""
    })

    const outputPath = convertImageToJpeg(inputPath, "image/heic")
    const conversionDirectory = dirname(outputPath)

    expect(existsSync(conversionDirectory)).toBe(true)

    cleanupConvertedImage(outputPath)

    expect(existsSync(conversionDirectory)).toBe(false)

    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("uses magick command on non-darwin platforms to avoid convert.exe collision", () => {
    withMockPlatform("linux", () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-platform-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")

      execFileSyncMock.mockImplementation((command: string, args: string[]) => {
        if (command === "magick") {
          writeFileSync(args[2], "jpeg")
        }
        return ""
      })

      const outputPath = convertImageToJpeg(inputPath, "image/heic")

      const [command, args] = execFileSyncMock.mock.calls[0] as [string, string[]]
      expect(command).toBe("magick")
      expect(args).toContain("--")
      expect(args.indexOf("--") < args.indexOf(inputPath)).toBe(true)
      expect(existsSync(outputPath)).toBe(true)

      cleanupConvertedImage(outputPath)
      if (existsSync(inputPath)) unlinkSync(inputPath)
      rmSync(testDir, { recursive: true, force: true })
    })
  })

  test("applies timeout when executing conversion commands", () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-timeout-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")

    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      writeConvertedOutput(command, args)
      return ""
    })

    const outputPath = convertImageToJpeg(inputPath, "image/heic")

    const options = execFileSyncMock.mock.calls[0]?.[2] as { timeout?: number } | undefined
    expect(options).toBeDefined()
    expect(typeof options?.timeout).toBe("number")
    expect((options?.timeout ?? 0) > 0).toBe(true)

    cleanupConvertedImage(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("attaches temporary output path to conversion errors", () => {
    withMockPlatform("linux", () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-failure-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")

      execFileSyncMock.mockImplementation(() => {
        throw new Error("conversion process failed")
      })

      const runConversion = () => convertImageToJpeg(inputPath, "image/heic")
      expect(runConversion).toThrow("No image conversion tool available")

      try {
        runConversion()
      } catch (error) {
        const conversionError = error as Error & { temporaryOutputPath?: string }
        expect(conversionError.temporaryOutputPath).toBeDefined()
        expect(conversionError.temporaryOutputPath?.endsWith("converted.jpg")).toBe(true)
      }

      if (existsSync(inputPath)) unlinkSync(inputPath)
      rmSync(testDir, { recursive: true, force: true })
    })
  })
})
