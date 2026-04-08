/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"
import { deflateSync } from "node:zlib"

const PNG_1X1_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

type ImageResizerModule = typeof import("./image-resizer")

async function importFreshImageResizerModule(): Promise<ImageResizerModule> {
  return import(`./image-resizer?test-${Date.now()}-${Math.random()}`)
}

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

function testCrc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function testCreateChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii")
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(testCrc32(crcInput) >>> 0, 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function createOversizedPngDataUrl(width: number, height: number): string {
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
    testCreateChunk("IHDR", ihdr),
    testCreateChunk("IDAT", idat),
    testCreateChunk("IEND", Buffer.alloc(0)),
  ])

  return `data:image/png;base64,${buffer.toString("base64")}`
}

describe("calculateTargetDimensions", () => {
  it("returns null when dimensions are already within limits", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(800, 600)

    //#then
    expect(result).toBeNull()
  })

  it("returns null at exact long-edge boundary", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(1568, 1000)

    //#then
    expect(result).toBeNull()
  })

  it("scales landscape dimensions by max long edge", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(3000, 2000)

    //#then
    expect(result).toEqual({
      width: 1568,
      height: Math.floor(2000 * (1568 / 3000)),
    })
  })

  it("scales portrait dimensions by max long edge", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(2000, 3000)

    //#then
    expect(result).toEqual({
      width: Math.floor(2000 * (1568 / 3000)),
      height: 1568,
    })
  })

  it("scales square dimensions to exact target", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(4000, 4000)

    //#then
    expect(result).toEqual({ width: 1568, height: 1568 })
  })

  it("uses custom maxLongEdge when provided", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(2000, 1000, 1000)

    //#then
    expect(result).toEqual({ width: 1000, height: 500 })
  })
})

describe("resizeImage", () => {
  afterEach(() => {
    mock.restore()
  })

  it("falls back to pure-JS resizer for PNG when sharp is unavailable", async () => {
    //#given
    mock.module("sharp", () => {
      throw new Error("sharp unavailable")
    })
    const { resizeImage } = await importFreshImageResizerModule()
    const oversizedPng = createOversizedPngDataUrl(3000, 2000)

    //#when
    const result = await resizeImage(oversizedPng, "image/png", {
      width: 1568,
      height: 1045,
    })

    //#then
    expect(result).not.toBeNull()
    expect(result?.resized).toEqual({ width: 1568, height: 1045 })
    expect(result?.original).toEqual({ width: 3000, height: 2000 })
    expect(result?.resizedDataUrl).toStartWith("data:image/png;base64,")
  })

  it("returns null for non-PNG when sharp is unavailable", async () => {
    //#given
    mock.module("sharp", () => {
      throw new Error("sharp unavailable")
    })
    const { resizeImage } = await importFreshImageResizerModule()

    //#when
    const result = await resizeImage(PNG_1X1_DATA_URL, "image/jpeg", {
      width: 1,
      height: 1,
    })

    //#then
    expect(result).toBeNull()
  })

  it("falls back to pure-JS resizer when sharp has unexpected shape", async () => {
    //#given
    mock.module("sharp", () => ({
      default: "not-a-function",
    }))
    const { resizeImage } = await importFreshImageResizerModule()
    const oversizedPng = createOversizedPngDataUrl(2000, 1000)

    //#when
    const result = await resizeImage(oversizedPng, "image/png", {
      width: 1568,
      height: 784,
    })

    //#then
    expect(result).not.toBeNull()
    expect(result?.resized).toEqual({ width: 1568, height: 784 })
  })

  it("returns null when sharp throws during resize", async () => {
    //#given
    const mockSharpFactory = mock(() => ({
      resize: () => {
        throw new Error("resize failed")
      },
    }))

    mock.module("sharp", () => ({
      default: mockSharpFactory,
    }))
    const { resizeImage } = await importFreshImageResizerModule()

    //#when
    const result = await resizeImage(PNG_1X1_DATA_URL, "image/png", {
      width: 1,
      height: 1,
    })

    //#then
    expect(result).toBeNull()
  })
})
