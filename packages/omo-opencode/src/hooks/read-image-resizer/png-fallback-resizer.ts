import type { ImageDimensions, ResizeResult } from "./types"
import { readPngChunks } from "./png-chunks"
import { PNG_SIGNATURE } from "./png-constants"
import { decodePngPixels } from "./png-decoder"
import { encodePng } from "./png-encoder"
import { getBytesPerPixel, parseIhdr } from "./png-ihdr"
import { nearestNeighborResize } from "./png-nearest-neighbor"
import { extractBase64Data } from "../../tools/look-at/mime-type-inference"
import { log } from "../../shared"

export function resizeImageFallback(
  base64DataUrl: string,
  mimeType: string,
  target: ImageDimensions,
): ResizeResult | null {
  if (mimeType.toLowerCase() !== "image/png") {
    return null
  }

  try {
    const rawBase64 = extractBase64Data(base64DataUrl)
    if (!rawBase64) {
      return null
    }

    const inputBuffer = Buffer.from(rawBase64, "base64")
    if (inputBuffer.length < 8) {
      return null
    }

    const signature = inputBuffer.subarray(0, 8)
    if (!signature.equals(PNG_SIGNATURE)) {
      return null
    }

    const chunks = readPngChunks(inputBuffer)
    const ihdrChunk = chunks.find((c) => c.type === "IHDR")
    if (!ihdrChunk) {
      return null
    }

    const ihdr = parseIhdr(ihdrChunk.data)
    if (!ihdr) {
      return null
    }

    const bytesPerPixel = getBytesPerPixel(ihdr.colorType, ihdr.bitDepth)
    if (!bytesPerPixel) {
      log("[png-fallback-resizer] unsupported color type or bit depth", {
        colorType: ihdr.colorType,
        bitDepth: ihdr.bitDepth,
      })
      return null
    }

    if (ihdr.bitDepth !== 8) {
      log("[png-fallback-resizer] only 8-bit depth supported for fallback", {
        bitDepth: ihdr.bitDepth,
      })
      return null
    }

    const idatChunks = chunks.filter((c) => c.type === "IDAT")
    if (idatChunks.length === 0) {
      return null
    }

    const idatData = Buffer.concat(idatChunks.map((c) => c.data))
    const sourcePixels = decodePngPixels(idatData, ihdr.width, ihdr.height, bytesPerPixel)
    if (!sourcePixels) {
      return null
    }

    const resizedPixels = nearestNeighborResize(
      sourcePixels,
      ihdr.width,
      ihdr.height,
      target.width,
      target.height,
      bytesPerPixel,
    )

    const outputBuffer = encodePng(
      resizedPixels,
      target.width,
      target.height,
      ihdr.bitDepth,
      ihdr.colorType,
      bytesPerPixel,
    )

    return {
      resizedDataUrl: `data:image/png;base64,${outputBuffer.toString("base64")}`,
      original: { width: ihdr.width, height: ihdr.height },
      resized: { width: target.width, height: target.height },
    }
  } catch (error) {
    log("[png-fallback-resizer] resize failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
