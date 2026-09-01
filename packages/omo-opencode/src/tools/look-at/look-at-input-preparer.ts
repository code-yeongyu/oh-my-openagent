import { readFileSync } from "node:fs"
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

export interface LookAtTextPart {
  type: "text"
  text: string
}

export type LookAtInputPart = LookAtFilePart | LookAtTextPart

export interface PreparedLookAtInput {
  readonly inputParts: LookAtInputPart[]
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

type ReadJsonTextPartResult =
  | { ok: true; value: LookAtTextPart }
  | { ok: false; error: string }

function readJsonTextPart(filePath: string): ReadJsonTextPartResult {
  let fileContent: string
  try {
    fileContent = readFileSync(filePath, "utf-8")
  } catch (error) {
    const code = error instanceof Error ? Reflect.get(error, "code") : undefined
    if (code === "ENOENT") {
      return { ok: false, error: `Error: File not found: ${filePath}` }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Error: Failed to read JSON file ${filePath}: ${message}` }
  }
  return {
    ok: true,
    value: {
      type: "text",
      text: `Attached JSON file (${basename(filePath)}):\n\n${fileContent}`,
    },
  }
}

function cleanupTempFiles(tempFiles: readonly string[]): void {
  for (const temporaryFile of tempFiles) {
    cleanupConvertedImage(temporaryFile)
  }
}

export function prepareLookAtInput(args: LookAtArgs): PrepareLookAtInputResult {
  const filePaths = args.file_paths ?? (args.file_path ? [args.file_path] : [])
  const imageDataList = args.image_data_list ?? (args.image_data ? [args.image_data] : [])
  const totalInputs = filePaths.length + imageDataList.length

  if (totalInputs === 0) {
    return {
      ok: false,
      error: "Error: Must provide either 'file_path', 'file_paths', 'image_data', or 'image_data_list'.",
    }
  }

  const inputParts: LookAtInputPart[] = []
  const tempFilesToCleanup: string[] = []

  for (const filePath of filePaths) {
    let mimeType = inferMimeTypeFromFilePath(filePath)
    let actualFilePath = filePath
    let tempConversionPath: string | null = null

    if (mimeType === "application/json") {
      const jsonPart = readJsonTextPart(filePath)
      if (!jsonPart.ok) {
        cleanupTempFiles(tempFilesToCleanup)
        return { ok: false, error: jsonPart.error }
      }
      inputParts.push(jsonPart.value)
      continue
    }

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
        cleanupTempFiles(tempFilesToCleanup)
        return {
          ok: false,
          error: `Error: Failed to convert image format. ${conversionError}`,
        }
      }
    }

    if (tempConversionPath) {
      tempFilesToCleanup.push(tempConversionPath)
    }

    inputParts.push({
      type: "file",
      mime: mimeType,
      url: pathToFileURL(actualFilePath).href,
      filename: basename(actualFilePath),
    })
  }

  for (const imageData of imageDataList) {
    const mimeType = inferMimeTypeFromBase64(imageData)

    let finalBase64Data = extractBase64Data(imageData)
    let finalMimeType = mimeType

    if (needsConversion(mimeType)) {
      log(`[look_at] Detected unsupported Base64 format: ${mimeType}, converting to JPEG...`)
      try {
        const { base64, tempFiles } = convertBase64ImageToJpeg(finalBase64Data, mimeType)
        finalBase64Data = base64
        finalMimeType = "image/jpeg"
        tempFilesToCleanup.push(...tempFiles)
        log("[look_at] Base64 conversion successful")
      } catch (conversionError) {
        log(`[look_at] Base64 conversion failed: ${conversionError}`)
        cleanupTempFiles(tempFilesToCleanup)
        return {
          ok: false,
          error: `Error: Failed to convert Base64 image format. ${conversionError}`,
        }
      }
    }

    inputParts.push({
      type: "file",
      mime: finalMimeType,
      url: `data:${finalMimeType};base64,${finalBase64Data}`,
      filename: `clipboard-image.${finalMimeType.split("/")[1] || "png"}`,
    })
  }

  const sourceDescription = totalInputs > 1
    ? `${totalInputs} files/images`
    : imageDataList.length === 1
      ? "clipboard/pasted image"
      : filePaths[0]

  return {
    ok: true,
    value: {
      inputParts,
      sourceDescription,
      cleanup() {
        cleanupTempFiles(tempFilesToCleanup)
      },
    },
  }
}
