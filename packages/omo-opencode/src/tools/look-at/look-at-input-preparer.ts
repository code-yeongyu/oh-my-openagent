import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import type { LookAtArgs } from "./types"
import {
  extractBase64Data,
  inferMimeTypeFromBase64,
  inferMimeTypeFromFilePath,
} from "./mime-type-inference"
import {
  needsConversion,
  convertImageToJpeg,
  convertBase64ImageToJpeg,
  cleanupConvertedImage,
} from "./image-converter"
import { log } from "../../shared"

export interface LookAtFilePart {
  type: "file"
  mime: string
  url: string
  filename: string
}

export interface PreparedLookAtInput {
  readonly filePart: LookAtFilePart
  readonly isBase64Input: boolean
  readonly sourceDescription: string
  cleanup(): void
}

type PrepareLookAtInputResult =
  | { ok: true; value: PreparedLookAtInput }
  | { ok: false; error: string }

function getTemporaryConversionPath(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const temporaryOutputPath = Reflect.get(error, "temporaryOutputPath")
  if (typeof temporaryOutputPath === "string" && temporaryOutputPath.length > 0) {
    return temporaryOutputPath
  }

  const temporaryDirectory = Reflect.get(error, "temporaryDirectory")
  if (typeof temporaryDirectory === "string" && temporaryDirectory.length > 0) {
    return temporaryDirectory
  }

  return null
}

export function prepareLookAtInput(args: LookAtArgs): PrepareLookAtInputResult {
  const imageData = args.image_data
  const filePath = args.file_path

  if (imageData) {
    const mimeType = inferMimeTypeFromBase64(imageData)

    let finalBase64Data = extractBase64Data(imageData)
    let finalMimeType = mimeType
    let tempFilesToCleanup: string[] = []

    if (needsConversion(mimeType)) {
      log(`[look_at] Detected unsupported Base64 format: ${mimeType}, converting to JPEG...`)
      try {
        const { base64, tempFiles } = convertBase64ImageToJpeg(finalBase64Data, mimeType)
        finalBase64Data = base64
        finalMimeType = "image/jpeg"
        tempFilesToCleanup = tempFiles
        log("[look_at] Base64 conversion successful")
      } catch (conversionError) {
        log(`[look_at] Base64 conversion failed: ${conversionError}`)
        return {
          ok: false,
          error: `Error: Failed to convert Base64 image format. ${conversionError}`,
        }
      }
    }

    return {
      ok: true,
      value: {
        isBase64Input: true,
        sourceDescription: "clipboard/pasted image",
        filePart: {
          type: "file",
          mime: finalMimeType,
          url: `data:${finalMimeType};base64,${finalBase64Data}`,
          filename: `clipboard-image.${finalMimeType.split("/")[1] || "png"}`,
        },
        cleanup() {
          for (const temporaryFile of tempFilesToCleanup) {
            cleanupConvertedImage(temporaryFile)
          }
        },
      },
    }
  }

  if (filePath) {
    let mimeType = inferMimeTypeFromFilePath(filePath)
    let actualFilePath = filePath
    let tempConversionPath: string | null = null

    if (needsConversion(mimeType)) {
      log(`[look_at] Detected unsupported format: ${mimeType}, converting to JPEG...`)
      try {
        const convertedFilePath = convertImageToJpeg(filePath, mimeType)
        tempConversionPath = convertedFilePath
        actualFilePath = convertedFilePath
        mimeType = "image/jpeg"
        log(`[look_at] Conversion successful: ${convertedFilePath}`)
      } catch (conversionError) {
        const failedConversionPath = getTemporaryConversionPath(conversionError)
        if (failedConversionPath) {
          tempConversionPath = failedConversionPath
        }
        log(`[look_at] Conversion failed: ${conversionError}`)
        return {
          ok: false,
          error: `Error: Failed to convert image format. ${conversionError}`,
        }
      }
    }

    return {
      ok: true,
      value: {
        isBase64Input: false,
        sourceDescription: filePath,
        filePart: {
          type: "file",
          mime: mimeType,
          url: pathToFileURL(actualFilePath).href,
          filename: basename(actualFilePath),
        },
        cleanup() {
          if (tempConversionPath) {
            cleanupConvertedImage(tempConversionPath)
          }
        },
      },
    }
  }

  return {
    ok: false,
    error: "Error: Must provide either 'file_path' or 'image_data'.",
  }
}
