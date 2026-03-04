import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { log } from "../../shared"

const SUPPORTED_FORMATS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
])

const UNSUPPORTED_FORMATS = new Set([
  "image/heic",
  "image/heif",
  "image/x-canon-cr2",
  "image/x-canon-crw",
  "image/x-nikon-nef",
  "image/x-nikon-nrw",
  "image/x-sony-arw",
  "image/x-sony-sr2",
  "image/x-sony-srf",
  "image/x-pentax-pef",
  "image/x-olympus-orf",
  "image/x-panasonic-raw",
  "image/x-fuji-raf",
  "image/x-adobe-dng",
  "image/vnd.adobe.photoshop",
  "image/x-photoshop",
])

const CONVERSION_TIMEOUT_MS = 30_000

export function needsConversion(mimeType: string): boolean {
  if (SUPPORTED_FORMATS.has(mimeType)) {
    return false
  }
  
  if (UNSUPPORTED_FORMATS.has(mimeType)) {
    return true
  }
  
  return mimeType.startsWith("image/")
}

export function convertImageToJpeg(inputPath: string, mimeType: string): string {
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`)
  }

  const tempDir = mkdtempSync(join(tmpdir(), "opencode-img-"))
  const outputPath = join(tempDir, "converted.jpg")

  log(`[image-converter] Converting ${mimeType} to JPEG: ${inputPath}`)

  try {
    if (process.platform === "darwin") {
      try {
        execFileSync("sips", ["-s", "format", "jpeg", "--", inputPath, "--out", outputPath], {
          stdio: "pipe",
          encoding: "utf-8",
          timeout: CONVERSION_TIMEOUT_MS,
        })
        
        if (existsSync(outputPath)) {
          log(`[image-converter] Converted using sips: ${outputPath}`)
          return outputPath
        }
      } catch (sipsError) {
        log(`[image-converter] sips failed: ${sipsError}`)
      }
    }

    try {
      const imagemagickCommand = process.platform === "darwin" ? "convert" : "magick"
      execFileSync(imagemagickCommand, ["--", inputPath, outputPath], {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: CONVERSION_TIMEOUT_MS,
      })
      
      if (existsSync(outputPath)) {
        log(`[image-converter] Converted using ImageMagick: ${outputPath}`)
        return outputPath
      }
    } catch (convertError) {
      log(`[image-converter] ImageMagick convert failed: ${convertError}`)
    }

    throw new Error(
      `No image conversion tool available. Please install ImageMagick:\n` +
      `  macOS: brew install imagemagick\n` +
      `  Ubuntu/Debian: sudo apt install imagemagick\n` +
      `  RHEL/CentOS: sudo yum install ImageMagick`
    )
  } catch (error) {
    try {
      if (existsSync(outputPath)) {
        unlinkSync(outputPath)
      }
    } catch {}

    if (error instanceof Error) {
      const conversionError = error as Error & { temporaryOutputPath?: string }
      conversionError.temporaryOutputPath = outputPath
    }
    
    throw error
  }
}

export function cleanupConvertedImage(filePath: string): void {
  try {
    const tempDirectory = dirname(filePath)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      log(`[image-converter] Cleaned up temporary file: ${filePath}`)
    }
    if (existsSync(tempDirectory)) {
      rmSync(tempDirectory, { recursive: true, force: true })
      log(`[image-converter] Cleaned up temporary directory: ${tempDirectory}`)
    }
  } catch (error) {
    log(`[image-converter] Failed to cleanup ${filePath}: ${error}`)
  }
}

export function convertBase64ImageToJpeg(
  base64Data: string,
  mimeType: string
): { base64: string; tempFiles: string[] } {
  const tempDir = mkdtempSync(join(tmpdir(), "opencode-b64-"))
  const inputExt = mimeType.split("/")[1] || "bin"
  const inputPath = join(tempDir, `input.${inputExt}`)
  const tempFiles: string[] = [inputPath]

  try {
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "")
    const buffer = Buffer.from(cleanBase64, "base64")
    writeFileSync(inputPath, buffer)

    log(`[image-converter] Converting Base64 ${mimeType} to JPEG`)
    
    const outputPath = convertImageToJpeg(inputPath, mimeType)
    tempFiles.push(outputPath)

    const convertedBuffer = readFileSync(outputPath)
    const convertedBase64 = convertedBuffer.toString("base64")

    log(`[image-converter] Base64 conversion successful`)
    
    return { base64: convertedBase64, tempFiles }
  } catch (error) {
    tempFiles.forEach(file => {
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch {}
    })
    throw error
  }
}
