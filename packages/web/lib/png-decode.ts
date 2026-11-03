import { inflateSync } from "node:zlib"

export interface DecodedPng {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
}

export class PngDecodeError extends Error {
  constructor(
    readonly reason: string,
    readonly offset?: number,
  ) {
    super(offset === undefined ? reason : `${reason} (byte ${offset})`)
    this.name = "PngDecodeError"
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const COLOR_TYPE_RGB = 2
const COLOR_TYPE_RGBA = 6
const FILTER_NONE = 0
const FILTER_SUB = 1
const FILTER_UP = 2
const FILTER_AVERAGE = 3
const FILTER_PAETH = 4

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index]
  if (value === undefined) throw new PngDecodeError("PNG data ends early", index)
  return value
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  return distanceUp <= distanceUpLeft ? up : upLeft
}

function unfilterByte(
  filter: number,
  byte: number,
  left: number,
  up: number,
  upLeft: number,
  row: number,
): number {
  switch (filter) {
    case FILTER_NONE:
      return byte
    case FILTER_SUB:
      return byte + left
    case FILTER_UP:
      return byte + up
    case FILTER_AVERAGE:
      return byte + ((left + up) >> 1)
    case FILTER_PAETH:
      return byte + paeth(left, up, upLeft)
    default:
      throw new PngDecodeError(`unknown scanline filter ${filter} on row ${row}`)
  }
}

interface PngHeader {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly compressed: Buffer
}

function readChunks(bytes: Uint8Array): PngHeader {
  PNG_SIGNATURE.forEach((expected, index) => {
    if (byteAt(bytes, index) !== expected) throw new PngDecodeError("not a PNG file", index)
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const imageData: Uint8Array[] = []
  for (let offset = PNG_SIGNATURE.length; offset < bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === "IHDR") {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      bitDepth = byteAt(bytes, offset + 16)
      colorType = byteAt(bytes, offset + 17)
      interlace = byteAt(bytes, offset + 20)
    } else if (type === "IDAT") {
      imageData.push(bytes.subarray(offset + 8, offset + 8 + length))
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new PngDecodeError(`unsupported PNG: bit depth ${bitDepth}, interlace ${interlace}`)
  }
  if (colorType !== COLOR_TYPE_RGB && colorType !== COLOR_TYPE_RGBA) {
    throw new PngDecodeError(`unsupported PNG colour type ${colorType}; expected RGB or RGBA`)
  }
  return {
    width,
    height,
    channels: colorType === COLOR_TYPE_RGBA ? 4 : 3,
    compressed: Buffer.concat(imageData),
  }
}

/**
 * Decodes the PNG subset the icon renderer emits — 8-bit RGB or RGBA, non-interlaced — into
 * RGBA pixels, so tests can inspect committed files without a native image dependency.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const { width, height, channels, compressed } = readChunks(bytes)
  const stride = width * channels
  const raw = new Uint8Array(inflateSync(compressed))
  const pixels = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  const current = new Uint8Array(stride)
  let position = 0
  for (let row = 0; row < height; row++) {
    const filter = byteAt(raw, position++)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? byteAt(current, x - channels) : 0
      const upLeft = x >= channels ? byteAt(previous, x - channels) : 0
      const value = unfilterByte(
        filter,
        byteAt(raw, position++),
        left,
        byteAt(previous, x),
        upLeft,
        row,
      )
      current[x] = value & 0xff
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (row * width + x) * 4
      pixels[to] = byteAt(current, from)
      pixels[to + 1] = byteAt(current, from + 1)
      pixels[to + 2] = byteAt(current, from + 2)
      pixels[to + 3] = channels === 4 ? byteAt(current, from + 3) : 0xff
    }
    previous.set(current)
  }
  return { width, height, pixels }
}
