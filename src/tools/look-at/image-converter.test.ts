import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

type ImageConverterModule = typeof import("./image-converter")
type CommandRunner = Parameters<ImageConverterModule["setImageConversionCommandRunnerForTesting"]>[0]
type CommandCall = {
  readonly command: Parameters<CommandRunner>[0]
  readonly args: Parameters<CommandRunner>[1]
  readonly options: Parameters<CommandRunner>[2]
}

async function loadImageConverter(): Promise<ImageConverterModule> {
  return import(`./image-converter?test=${Date.now()}-${Math.random()}`)
}

function writeConvertedOutput(command: string, args: ReadonlyArray<string>): void {
  if (command === "sips") {
    const outIndex = args.indexOf("--out")
    const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined
    if (outputPath) {
      writeFileSync(outputPath, "jpeg")
    }
    return
  }

  if (command === "convert") {
    const outputPath = args[2]
    if (outputPath) {
      writeFileSync(outputPath, "jpeg")
    }
    return
  }

  if (command === "magick") {
    const outputPath = args[2]
    if (outputPath) {
      writeFileSync(outputPath, "jpeg")
    }
  }
}

function installCommandRunner(
  imageConverter: ImageConverterModule,
  runCommand: (command: string, args: ReadonlyArray<string>) => void = writeConvertedOutput,
): { readonly calls: CommandCall[]; readonly restore: () => void } {
  const calls: CommandCall[] = []
  const restore = imageConverter.setImageConversionCommandRunnerForTesting((command, args, options) => {
    calls.push({ command, args: [...args], options })
    runCommand(command, args)
  })

  return { calls, restore }
}

function getTemporaryOutputPath(error: unknown): string {
  if (error instanceof Error && "temporaryOutputPath" in error && typeof error.temporaryOutputPath === "string") {
    return error.temporaryOutputPath
  }

  throw new Error("Expected conversion error to include a temporary output path")
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
  test("uses execFileSync with argument arrays for conversion commands", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-test-"))
    const inputPath = join(testDir, "evil$(touch_pwn).heic")
    writeFileSync(inputPath, "fake-heic-data")
    const imageConverter = await loadImageConverter()
    const { calls, restore } = installCommandRunner(imageConverter)

    const outputPath = imageConverter.convertImageToJpeg(inputPath, "image/heic")
    restore()

    const firstCall = calls[0]
    expect(firstCall).toBeDefined()
    expect(typeof firstCall?.command).toBe("string")
    expect(Array.isArray(firstCall?.args)).toBe(true)
    expect(["sips", "convert", "magick"]).toContain(firstCall?.command)
    expect(firstCall?.args).toContain("--")
    expect(firstCall?.args).toContain(inputPath)
    expect((firstCall?.args.indexOf("--") ?? Number.MAX_SAFE_INTEGER) < (firstCall?.args.indexOf(inputPath) ?? -1)).toBe(true)
    expect(firstCall?.args.join(" ")).not.toContain(`"${inputPath}"`)

    expect(existsSync(outputPath)).toBe(true)

    if (existsSync(outputPath)) unlinkSync(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("removes temporary conversion directory during cleanup", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-cleanup-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")
    const imageConverter = await loadImageConverter()
    const { restore } = installCommandRunner(imageConverter)

    const outputPath = imageConverter.convertImageToJpeg(inputPath, "image/heic")
    restore()
    const conversionDirectory = dirname(outputPath)

    expect(existsSync(conversionDirectory)).toBe(true)

    imageConverter.cleanupConvertedImage(outputPath)

    expect(existsSync(conversionDirectory)).toBe(false)

    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("uses magick command on non-darwin platforms to avoid convert.exe collision", async () => {
    await withMockPlatform("linux", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-platform-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")
      const imageConverter = await loadImageConverter()
      const { calls, restore } = installCommandRunner(imageConverter)

      const outputPath = imageConverter.convertImageToJpeg(inputPath, "image/heic")
      restore()

      const firstCall = calls[0]
      expect(firstCall?.command).toBe("magick")
      expect(firstCall?.args).toContain("--")
      expect((firstCall?.args.indexOf("--") ?? Number.MAX_SAFE_INTEGER) < (firstCall?.args.indexOf(inputPath) ?? -1)).toBe(true)
      expect(existsSync(outputPath)).toBe(true)

      imageConverter.cleanupConvertedImage(outputPath)
      if (existsSync(inputPath)) unlinkSync(inputPath)
      rmSync(testDir, { recursive: true, force: true })
    })
  })

  test("applies timeout when executing conversion commands", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "img-converter-timeout-test-"))
    const inputPath = join(testDir, "photo.heic")
    writeFileSync(inputPath, "fake-heic-data")
    const imageConverter = await loadImageConverter()
    const { calls, restore } = installCommandRunner(imageConverter)

    const outputPath = imageConverter.convertImageToJpeg(inputPath, "image/heic")
    restore()

    const firstCall = calls[0]
    expect(firstCall?.options).toBeDefined()
    expect(typeof firstCall?.options.timeout).toBe("number")
    expect((firstCall?.options.timeout ?? 0) > 0).toBe(true)

    imageConverter.cleanupConvertedImage(outputPath)
    if (existsSync(inputPath)) unlinkSync(inputPath)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("attaches temporary output path to conversion errors", async () => {
    await withMockPlatform("linux", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "img-converter-failure-test-"))
      const inputPath = join(testDir, "photo.heic")
      writeFileSync(inputPath, "fake-heic-data")
      const imageConverter = await loadImageConverter()

      const { restore } = installCommandRunner(imageConverter, () => {
        throw new Error("conversion process failed")
      })

      const runConversion = () => imageConverter.convertImageToJpeg(inputPath, "image/heic")
      expect(runConversion).toThrow("No image conversion tool available")

      try {
        runConversion()
      } catch (error) {
        const temporaryOutputPath = getTemporaryOutputPath(error)
        expect(temporaryOutputPath.endsWith("converted.jpg")).toBe(true)
      }
      restore()

      if (existsSync(inputPath)) unlinkSync(inputPath)
      rmSync(testDir, { recursive: true, force: true })
    })
  })
})
