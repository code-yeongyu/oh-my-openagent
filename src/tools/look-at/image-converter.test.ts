import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

type ImageConverterModule = typeof import("./image-converter")

async function loadImageConverter(): Promise<ImageConverterModule> {
  return import(`./image-converter?test=${Date.now()}-${Math.random()}`)
}

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

async function withMockPlatform<TValue>(
  platform: NodeJS.Platform,
  run: () => TValue | Promise<TValue>,
): Promise<TValue> {
  const originalPlatform = process.platform
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })

  try {
    return await run()
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    })
  }
}

describe("image-converter command execution safety", () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>
  let execSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    execSyncSpy = spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("execSync should not be called")
    })

    execFileSyncSpy = spyOn(childProcess, "execFileSync").mockImplementation(
      ((_command: string, _args: string[], _options?: unknown) => "") as typeof childProcess.execFileSync,
    )
  })

  afterEach(() => {
    execFileSyncSpy.mockRestore()
    execSyncSpy.mockRestore()
  })

  test("uses execFileSync with argument arrays for conversion commands", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-test-"))
    const inputPath = join(testDir, "evil$(touch_pwn).heic")
    writeFileSync(inputPath, "fake-heic-data")
    const { convertImageToJpeg } = await loadImageConverter()

    execFileSyncSpy.mockImplementation(
      ((command: string, args: string[]) => {
        writeConvertedOutput(command, args)
        return ""
      }) as typeof childProcess.execFileSync,
    )

    const outputPath = convertImageToJpeg(inputPath, "image/heic")

    expect(execSyncSpy).not.toHaveBeenCalled()
    expect(execFileSyncSpy).toHaveBeenCalled()

    const [firstCommand, firstArgs] = execFileSyncSpy.mock.calls[0] as [string, string[]]
    expect(typeof firstCommand).toBe("string")
    expect(Array.isArray(firstArgs)).toBe(true)
    expect(["sips", "convert", "magick"]).toContain(firstCommand)
    expect(firstArgs).toContain("--")
    expect(firstArgs).toContain(inputPath)
    expect(firstArgs.indexOf("--") < firstArgs.indexOf(inputPath)).toBe(true)
    expect(firstArgs.join(" ")).not.toContain(`"${inputPath}"`)

    expect(existsSync(outputPath)).toBe(true)

    if (existsSync(outputPath)) unlinkSync(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("removes temporary conversion directory during cleanup", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-cleanup-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")
    const { convertImageToJpeg, cleanupConvertedImage } = await loadImageConverter()

    execFileSyncSpy.mockImplementation(
      ((command: string, args: string[]) => {
        writeConvertedOutput(command, args)
        return ""
      }) as typeof childProcess.execFileSync,
    )

    const outputPath = convertImageToJpeg(inputPath, "image/heic")
    const conversionDirectory = dirname(outputPath)

    expect(existsSync(conversionDirectory)).toBe(true)

    cleanupConvertedImage(outputPath)

    expect(existsSync(conversionDirectory)).toBe(false)

    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("uses magick command on non-darwin platforms to avoid convert.exe collision", async () => {
    await withMockPlatform("linux", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-platform-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")
      const { convertImageToJpeg, cleanupConvertedImage } = await loadImageConverter()

      execFileSyncSpy.mockImplementation(
        ((command: string, args: string[]) => {
          if (command === "magick") {
            writeFileSync(args[2], "jpeg")
          }
          return ""
        }) as typeof childProcess.execFileSync,
      )

      const outputPath = convertImageToJpeg(inputPath, "image/heic")

      const [command, args] = execFileSyncSpy.mock.calls[0] as [string, string[]]
      expect(command).toBe("magick")
      expect(args).toContain("--")
      expect(args.indexOf("--") < args.indexOf(inputPath)).toBe(true)
      expect(existsSync(outputPath)).toBe(true)

      cleanupConvertedImage(outputPath)
      if (existsSync(inputPath)) unlinkSync(inputPath)
      rmSync(testDir, { recursive: true, force: true })
    })
  })

  test("applies timeout when executing conversion commands", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-timeout-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")
    const { convertImageToJpeg, cleanupConvertedImage } = await loadImageConverter()

    execFileSyncSpy.mockImplementation(
      ((command: string, args: string[]) => {
        writeConvertedOutput(command, args)
        return ""
      }) as typeof childProcess.execFileSync,
    )

    const outputPath = convertImageToJpeg(inputPath, "image/heic")

    const options = execFileSyncSpy.mock.calls[0]?.[2] as { timeout?: number } | undefined
    expect(options).toBeDefined()
    expect(typeof options?.timeout).toBe("number")
    expect((options?.timeout ?? 0) > 0).toBe(true)

    cleanupConvertedImage(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("attaches temporary output path to conversion errors", async () => {
    await withMockPlatform("linux", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-failure-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")
      const { convertImageToJpeg } = await loadImageConverter()

      execFileSyncSpy.mockImplementation((() => {
        throw new Error("conversion process failed")
      }) as typeof childProcess.execFileSync)

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
