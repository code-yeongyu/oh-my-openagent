import { inflateSync, deflateSync } from "node:zlib"

import type { ImageDimensions, ResizeResult } from "./types"
import { extractBase64Data } from "../../tools/look-at/mime-type-inference"
import { log } from "../../shared"

interface PngChunk {
  type: string
  data: Buffer
  crc: Buffer
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngChunks(buffer: Buffer): PngChunk[] {
  const chunks: PngChunk[] = []
  let offset = 8

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      break
    }

    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd + 4 > buffer.length) {
      break
    }

    const data = buffer.subarray(dataStart, dataEnd)
    const crc = buffer.subarray(dataEnd, dataEnd + 4)
    chunks.push({ type, data, crc })
    offset = dataEnd + 4
  }

  return chunks
}

function parseIhdr(data: Buffer): { width: number; height: number; bitDepth: number; colorType: number } | null {
  if (data.length < 13) {
    return null
  }

  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colorType: data[9],
  }
}

function getBytesPerPixel(colorType: number, bitDepth: number): number | null {
  const channels: Record<number, number> = {
    0: 1, // grayscale
    2: 3, // RGB
    4: 2, // grayscale + alpha
    6: 4, // RGBA
  }

  const channelCount = channels[colorType]
  if (channelCount === undefined) {
    return null
  }

  return channelCount * (bitDepth / 8)
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)

  if (pa <= pb && pa <= pc) {
    return a
  }

  if (pb <= pc) {
    return b
  }

  return c
}

function unfilterRow(
  filterType: number,
  currentRow: Buffer,
  previousRow: Buffer | null,
  bytesPerPixel: number,
): Buffer {
  const result = Buffer.alloc(currentRow.length)

  for (let i = 0; i < currentRow.length; i++) {
    const raw = currentRow[i]
    const a = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0
    const b = previousRow ? previousRow[i] : 0
    const c = i >= bytesPerPixel && previousRow ? previousRow[i - bytesPerPixel] : 0

    switch (filterType) {
      case 0:
        result[i] = raw
        break
      case 1:
        result[i] = (raw + a) & 0xff
        break
      case 2:
        result[i] = (raw + b) & 0xff
        break
      case 3:
        result[i] = (raw + Math.floor((a + b) / 2)) & 0xff
        break
      case 4:
        result[i] = (raw + paethPredictor(a, b, c)) & 0xff
        break
      default:
        result[i] = raw
    }
  }

  return result
}

function decodePngPixels(
  idatData: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer | null {
  try {
    const decompressed = inflateSync(idatData)
    const rowBytes = width * bytesPerPixel
    const expectedLength = height * (rowBytes + 1)

    if (decompressed.length < expectedLength) {
      return null
    }

    const pixels = Buffer.alloc(width * height * bytesPerPixel)
    let previousRow: Buffer | null = null

    for (let y = 0; y < height; y++) {
      const rowStart = y * (rowBytes + 1)
      const filterType = decompressed[rowStart]
      const filteredRow = decompressed.subarray(rowStart + 1, rowStart + 1 + rowBytes)
      const unfilteredRow = unfilterRow(filterType, filteredRow, previousRow, bytesPerPixel)

      unfilteredRow.copy(pixels, y * rowBytes)
      previousRow = unfilteredRow
    }

    return pixels
  } catch {
    return null
  }
}

function nearestNeighborResize(
  sourcePixels: Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  bytesPerPixel: number,
): Buffer {
  const destPixels = Buffer.alloc(dstWidth * dstHeight * bytesPerPixel)

  for (let dstY = 0; dstY < dstHeight; dstY++) {
    const srcY = Math.min(Math.floor((dstY * srcHeight) / dstHeight), srcHeight - 1)

    for (let dstX = 0; dstX < dstWidth; dstX++) {
      const srcX = Math.min(Math.floor((dstX * srcWidth) / dstWidth), srcWidth - 1)
      const srcOffset = (srcY * srcWidth + srcX) * bytesPerPixel
      const dstOffset = (dstY * dstWidth + dstX) * bytesPerPixel

      for (let b = 0; b < bytesPerPixel; b++) {
        destPixels[dstOffset + b] = sourcePixels[srcOffset + b]
      }
    }
  }

  return destPixels
}

function encodePng(
  pixels: Buffer,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  bytesPerPixel: number,
): Buffer {
  const rowBytes = width * bytesPerPixel
  const filteredData = Buffer.alloc(height * (rowBytes + 1))

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1)
    filteredData[rowOffset] = 0
    pixels.copy(filteredData, rowOffset + 1, y * rowBytes, (y + 1) * rowBytes)
  }

  const compressedData = deflateSync(filteredData)

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = bitDepth
  ihdrData[9] = colorType
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0

  const ihdrChunk = createChunk("IHDR", ihdrData)
  const idatChunk = createChunk("IDAT", compressedData)
  const iendChunk = createChunk("IEND", Buffer.alloc(0))

  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk])
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii")
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)

  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = crc32(crcInput)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc >>> 0, 0)

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1)
      } else {
        c = c >>> 1
      }
    }

    table[n] = c
  }

  return table
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff

  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

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
