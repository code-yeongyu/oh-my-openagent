import type { ImageDimensions } from "./types"

import { extractBase64Data } from "../../tools/look-at/mime-type-inference"

function toImageDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  if (width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function parsePngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) {
    return null
  }

  const isPngSignature =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a

  if (!isPngSignature || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return toImageDimensions(width, height)
}

function parseGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) {
    return null
  }

  if (buffer.toString("ascii", 0, 4) !== "GIF8") {
    return null
  }

  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  return toImageDimensions(width, height)
}

function parseJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1
    }

    if (offset >= buffer.length) {
      return null
    }

    const marker = buffer[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    if (offset + 1 >= buffer.length) {
      return null
    }

    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2) {
      return null
    }

    if ((marker === 0xc0 || marker === 0xc2) && offset + 7 < buffer.length) {
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      return toImageDimensions(width, height)
    }

    offset += segmentLength
  }

  return null
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function parseWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 16) {
    return null
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null
  }

  const chunkType = buffer.toString("ascii", 12, 16)

  if (chunkType === "VP8 ") {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      return null
    }

    const width = buffer.readUInt16LE(26) & 0x3fff
    const height = buffer.readUInt16LE(28) & 0x3fff
    return toImageDimensions(width, height)
  }

  if (chunkType === "VP8L") {
    if (buffer.length < 25 || buffer[20] !== 0x2f) {
      return null
    }

    const bits = buffer.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >>> 14) & 0x3fff) + 1
    return toImageDimensions(width, height)
  }

  if (chunkType === "VP8X") {
    const width = readUInt24LE(buffer, 24) + 1
    const height = readUInt24LE(buffer, 27) + 1
    return toImageDimensions(width, height)
  }

  return null
}

export function parseImageDimensions(base64DataUrl: string, mimeType: string): ImageDimensions | null {
  try {
    if (!base64DataUrl || !mimeType) {
      return null
    }

    const rawBase64 = extractBase64Data(base64DataUrl)
    if (!rawBase64) {
      return null
    }

    const buffer = Buffer.from(rawBase64, "base64")
    if (buffer.length === 0) {
      return null
    }

    const normalizedMime = mimeType.toLowerCase()

    if (normalizedMime === "image/png") {
      return parsePngDimensions(buffer)
    }

    if (normalizedMime === "image/gif") {
      return parseGifDimensions(buffer)
    }

    if (normalizedMime === "image/jpeg" || normalizedMime === "image/jpg") {
      return parseJpegDimensions(buffer)
    }

    if (normalizedMime === "image/webp") {
      return parseWebpDimensions(buffer)
    }

    return null
  } catch {
    return null
  }
}
