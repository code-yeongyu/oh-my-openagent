/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { deflateSync } from "node:zlib"

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

function createValidRgbaPng(width: number, height: number): string {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowBytes = width * 4
  const rawData = Buffer.alloc(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1)
    rawData[rowOffset] = 0
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4
      rawData[pixelOffset] = (x * 255) % 256
      rawData[pixelOffset + 1] = (y * 255) % 256
      rawData[pixelOffset + 2] = ((x + y) * 127) % 256
      rawData[pixelOffset + 3] = 255
    }
  }

  const idat = deflateSync(rawData)
  const buffer = Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", idat),
    createChunk("IEND", Buffer.alloc(0)),
  ])

  return `data:image/png;base64,${buffer.toString("base64")}`
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
      expect(result?.original).toEqual({ width: 2000, height: 1500 })
      expect(result?.resized).toEqual({ width: 1568, height: 1176 })

      const parsed = parseImageDimensions(result!.resizedDataUrl, "image/png")
      expect(parsed).toEqual({ width: 1568, height: 1176 })
    })

    it("#when target is much smaller #then produces a valid PNG decodable by parser", () => {
      //#given
      const sourcePng = createValidRgbaPng(800, 800)

      //#when
      const result = resizeImageFallback(sourcePng, "image/png", { width: 100, height: 100 })

      //#then
      expect(result).not.toBeNull()
      const parsed = parseImageDimensions(result!.resizedDataUrl, "image/png")
      expect(parsed).toEqual({ width: 100, height: 100 })
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
