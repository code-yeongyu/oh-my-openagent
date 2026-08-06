import { deflateSync } from "node:zlib"

import { PNG_SIGNATURE } from "./png-constants"
import { crc32 } from "./png-crc"

export function encodePng(
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
