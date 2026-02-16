import { execSync } from "node:child_process"
import { existsSync, mkdtempSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
        execSync(`sips -s format jpeg "${inputPath}" --out "${outputPath}"`, {
          stdio: "pipe",
          encoding: "utf-8",
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
      execSync(`convert "${inputPath}" "${outputPath}"`, {
        stdio: "pipe",
        encoding: "utf-8",
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
    
    throw error
  }
}

export function cleanupConvertedImage(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      log(`[image-converter] Cleaned up temporary file: ${filePath}`)
    }
  } catch (error) {
    log(`[image-converter] Failed to cleanup ${filePath}: ${error}`)
  }
}
