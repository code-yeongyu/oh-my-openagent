import type { ImageDimensions, ResizeResult } from "./types"
import { extractBase64Data } from "../../tools/look-at/mime-type-inference"
import { log } from "../../shared"

const ANTHROPIC_MAX_LONG_EDGE = 1568
const ANTHROPIC_MAX_FILE_SIZE = 5 * 1024 * 1024

type SharpFormat = "jpeg" | "png" | "gif" | "webp"

interface SharpMetadata {
  width?: number
  height?: number
}

interface SharpInstance {
  resize(width: number, height: number, options: { fit: "inside" }): SharpInstance
  toFormat(format: SharpFormat, options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
  metadata(): Promise<SharpMetadata>
}

type SharpFactory = (input: Buffer) => SharpInstance

function resolveSharpFactory(sharpModule: unknown): SharpFactory | null {
  if (typeof sharpModule === "function") {
    return sharpModule as SharpFactory
  }

  if (!sharpModule || typeof sharpModule !== "object") {
    return null
  }

  const defaultExport = Reflect.get(sharpModule, "default")
  return typeof defaultExport === "function" ? (defaultExport as SharpFactory) : null
}

function resolveSharpFormat(mimeType: string): SharpFormat {
  const normalizedMime = mimeType.toLowerCase()
  if (normalizedMime === "image/png") {
    return "png"
  }
  if (normalizedMime === "image/gif") {
    return "gif"
  }
  if (normalizedMime === "image/webp") {
    return "webp"
  }
  return "jpeg"
}

function canAdjustQuality(format: SharpFormat): boolean {
  return format === "jpeg" || format === "webp"
}

function toDimensions(metadata: SharpMetadata): ImageDimensions | null {
  const { width, height } = metadata
  if (!width || !height) {
    return null
  }
  return { width, height }
}

async function renderResizedBuffer(args: {
  sharpFactory: SharpFactory
  inputBuffer: Buffer
  target: ImageDimensions
  format: SharpFormat
  quality?: number
}): Promise<Buffer> {
  const { sharpFactory, inputBuffer, target, format, quality } = args
  return sharpFactory(inputBuffer)
    .resize(target.width, target.height, { fit: "inside" })
    .toFormat(format, quality ? { quality } : undefined)
    .toBuffer()
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maxLongEdge = ANTHROPIC_MAX_LONG_EDGE,
): ImageDimensions | null {
  if (width <= 0 || height <= 0 || maxLongEdge <= 0) {
    return null
  }

  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) {
    return null
  }

  if (width >= height) {
    return {
      width: maxLongEdge,
      height: Math.max(1, Math.floor((height * maxLongEdge) / width)),
    }
  }

  return {
    width: Math.max(1, Math.floor((width * maxLongEdge) / height)),
    height: maxLongEdge,
  }
}

export async function resizeImage(
  base64DataUrl: string,
  mimeType: string,
  target: ImageDimensions,
): Promise<ResizeResult | null> {
  try {
    const sharpModuleName = "sharp"
    const sharpModule = await import(sharpModuleName).catch(() => null)
    if (!sharpModule) {
      log("[read-image-resizer] sharp unavailable, skipping resize")
      return null
    }

    const sharpFactory = resolveSharpFactory(sharpModule)
    if (!sharpFactory) {
      log("[read-image-resizer] sharp import has unexpected shape")
      return null
    }

    const rawBase64 = extractBase64Data(base64DataUrl)
    if (!rawBase64) {
      return null
    }

    const inputBuffer = Buffer.from(rawBase64, "base64")
    if (inputBuffer.length === 0) {
      return null
    }

    const original = toDimensions(await sharpFactory(inputBuffer).metadata())
    if (!original) {
      return null
    }

    const format = resolveSharpFormat(mimeType)
    let resizedBuffer = await renderResizedBuffer({
      sharpFactory,
      inputBuffer,
      target,
      format,
    })

    if (resizedBuffer.length > ANTHROPIC_MAX_FILE_SIZE && canAdjustQuality(format)) {
      for (const quality of [80, 60, 40]) {
        resizedBuffer = await renderResizedBuffer({
          sharpFactory,
          inputBuffer,
          target,
          format,
          quality,
        })

        if (resizedBuffer.length <= ANTHROPIC_MAX_FILE_SIZE) {
          break
        }
      }
    }

    const resized = toDimensions(await sharpFactory(resizedBuffer).metadata())
    if (!resized) {
      return null
    }

    return {
      resizedDataUrl: `data:${mimeType};base64,${resizedBuffer.toString("base64")}`,
      original,
      resized,
    }
  } catch (error) {
    log("[read-image-resizer] resize failed", {
      error: getErrorMessage(error),
      mimeType,
      target,
    })
    return null
  }
}
