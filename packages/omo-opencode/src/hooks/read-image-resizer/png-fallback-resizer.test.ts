/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { deflateSync, inflateSync } from "node:zlib"

import { resizeImageFallback } from "./png-fallback-resizer"
import { parseImageDimensions } from "./image-dimensions"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii")
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(crcInput) >>> 0, 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
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

type TestPngOptions = {
  readonly ihdrWidth?: number
  readonly ihdrHeight?: number
  readonly interlaceMethod?: number
  readonly splitIdatAt?: number
  readonly rowFilterType?: number
}

function createValidRgbaPng(width: number, height: number, options: TestPngOptions = {}): string {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(options.ihdrWidth ?? width, 0)
  ihdr.writeUInt32BE(options.ihdrHeight ?? height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = options.interlaceMethod ?? 0

  const rowBytes = width * 4
  const rawData = Buffer.alloc(height * (rowBytes + 1))
  let previousUnfilteredRow: Buffer | null = null

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1)
    const filterType = options.rowFilterType ?? 0
    const unfilteredRow = Buffer.alloc(rowBytes)
    rawData[rowOffset] = filterType

    for (let x = 0; x < width; x++) {
      const pixelOffset = x * 4
      unfilteredRow[pixelOffset] = (x * 255) % 256
      unfilteredRow[pixelOffset + 1] = (y * 255) % 256
      unfilteredRow[pixelOffset + 2] = ((x + y) * 127) % 256
      unfilteredRow[pixelOffset + 3] = 255
    }

    for (let i = 0; i < rowBytes; i++) {
      const raw = unfilteredRow[i]
      if (filterType === 0) {
        rawData[rowOffset + 1 + i] = raw
        continue
      }

      if (filterType !== 4) {
        rawData[rowOffset + 1 + i] = raw
        continue
      }

      const a = i >= 4 ? unfilteredRow[i - 4] : 0
      const b = previousUnfilteredRow ? previousUnfilteredRow[i] : 0
      const c = i >= 4 && previousUnfilteredRow ? previousUnfilteredRow[i - 4] : 0
      rawData[rowOffset + 1 + i] = (raw - paethPredictor(a, b, c)) & 0xff
    }

    previousUnfilteredRow = unfilteredRow
  }

  const idat = deflateSync(rawData)
  const idatChunks =
    options.splitIdatAt === undefined
      ? [createChunk("IDAT", idat)]
      : [
          createChunk("IDAT", idat.subarray(0, options.splitIdatAt)),
          createChunk("IDAT", idat.subarray(options.splitIdatAt)),
        ]
  const buffer = Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    ...idatChunks,
    createChunk("IEND", Buffer.alloc(0)),
  ])

  return `data:image/png;base64,${buffer.toString("base64")}`
}

function readOutputPixel(dataUrl: string, x: number): readonly number[] | null {
  const encoded = dataUrl.split(",", 2)[1]
  if (!encoded) {
    return null
  }

  const buffer = Buffer.from(encoded, "base64")
  const idatChunks: Buffer[] = []
  let offset = PNG_SIGNATURE.length

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd + 4 > buffer.length) {
      return null
    }

    if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataEnd))
    }

    offset = dataEnd + 4
  }

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const pixelOffset = 1 + x * 4
  return Array.from(inflated.subarray(pixelOffset, pixelOffset + 4))
}

describe("resizeImageFallback", () => {
  describe("#given a valid RGBA PNG larger than the target", () => {
    it("#when called #then returns a smaller PNG with target dimensions", () => {
      //#given
      const sourcePng = createValidRgbaPng(2000, 1500)

      //#when
      const result = resizeImageFallback(sourcePng, "image/png", { width: 1568, height: 1176 })

      //#then
      expect(result).not.toBeNull()
      if (result === null) {
        throw new Error("Expected resized image result")
      }
      expect(result.original).toEqual({ width: 2000, height: 1500 })
      expect(result.resized).toEqual({ width: 1568, height: 1176 })

      const parsed = parseImageDimensions(result.resizedDataUrl, "image/png")
      expect(parsed).toEqual({ width: 1568, height: 1176 })
    })

    it("#when target is much smaller #then produces a valid PNG decodable by parser", () => {
      //#given
      const sourcePng = createValidRgbaPng(800, 800)

      //#when
      const result = resizeImageFallback(sourcePng, "image/png", { width: 100, height: 100 })

      //#then
      expect(result).not.toBeNull()
      if (result === null) {
        throw new Error("Expected resized image result")
      }
      const parsed = parseImageDimensions(result.resizedDataUrl, "image/png")
      expect(parsed).toEqual({ width: 100, height: 100 })
    })

    it("#when IDAT data is split across chunks #then concatenates chunks before decoding", () => {
      //#given
      const sourcePng = createValidRgbaPng(640, 320, { splitIdatAt: 4 })

      //#when
      const result = resizeImageFallback(sourcePng, "image/png", { width: 320, height: 160 })

      //#then
      if (result === null) {
        expect(result).not.toBeNull()
        return
      }

      expect(result.original).toEqual({ width: 640, height: 320 })
      const parsed = parseImageDimensions(result.resizedDataUrl, "image/png")
      expect(parsed).toEqual({ width: 320, height: 160 })
    })

    it("#when rows use PNG filter type 4 #then preserves unfiltered pixel data", () => {
      //#given
      const sourcePng = createValidRgbaPng(2, 1, { rowFilterType: 4 })

      //#when
      const result = resizeImageFallback(sourcePng, "image/png", { width: 2, height: 1 })

      //#then
      if (result === null) {
        expect(result).not.toBeNull()
        return
      }

      expect(readOutputPixel(result.resizedDataUrl, 1)).toEqual([255, 0, 127, 255])
    })
  })

  describe("#given a non-PNG mime type", () => {
    it("#when called #then returns null", () => {
      //#given
      const sourcePng = createValidRgbaPng(2000, 1500)

      //#when
      const result = resizeImageFallback(sourcePng, "image/jpeg", { width: 1568, height: 1176 })

      //#then
      expect(result).toBeNull()
    })
  })

  describe("#given an invalid PNG buffer", () => {
    it("#when called #then returns null", () => {
      //#given
      const invalidPng = "data:image/png;base64,AAAA"

      //#when
      const result = resizeImageFallback(invalidPng, "image/png", { width: 100, height: 100 })

      //#then
      expect(result).toBeNull()
    })
  })

  describe("#given unsupported PNG metadata", () => {
    it("#when IHDR width is zero #then returns null", () => {
      //#given
      const invalidPng = createValidRgbaPng(2, 1, { ihdrWidth: 0 })

      //#when
      const result = resizeImageFallback(invalidPng, "image/png", { width: 2, height: 1 })

      //#then
      expect(result).toBeNull()
    })

    it("#when IHDR requests interlacing #then returns null", () => {
      //#given
      const interlacedPng = createValidRgbaPng(2, 1, { interlaceMethod: 1 })

      //#when
      const result = resizeImageFallback(interlacedPng, "image/png", { width: 2, height: 1 })

      //#then
      expect(result).toBeNull()
    })

    it("#when row filter byte is unknown #then returns null", () => {
      //#given
      const invalidPng = createValidRgbaPng(2, 1, { rowFilterType: 9 })

      //#when
      const result = resizeImageFallback(invalidPng, "image/png", { width: 2, height: 1 })

      //#then
      expect(result).toBeNull()
    })
  })

  describe("#given empty base64 data", () => {
    it("#when called #then returns null", () => {
      //#given
      const empty = "data:image/png;base64,"

      //#when
      const result = resizeImageFallback(empty, "image/png", { width: 100, height: 100 })

      //#then
      expect(result).toBeNull()
    })
  })
})
