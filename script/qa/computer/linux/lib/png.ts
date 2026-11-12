// A PNG reader for the frames the engine returns, so a scenario asserts pixels rather than
// the engine's own numbers. Only the 8-bit RGB/RGBA non-interlaced form the engine writes is
// read; anything else throws, so a decoding slip can never pass as a pixel fact.
import type { Raster } from "./pixels.ts"

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(bytes: Uint8Array): Raster {
  for (const [index, byte] of SIGNATURE.entries()) {
    if (bytes[index] !== byte) throw new Error("not a PNG")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let header: { width: number; height: number; channels: number } | undefined
  const parts: Uint8Array[] = []
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at, false)
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (kind === "IHDR") {
      const depth = body[8]
      const colour = body[9]
      if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not 8`)
      if (colour !== 2 && colour !== 6) throw new Error(`PNG colour type ${colour} is not RGB or RGBA`)
      if (body[12] !== 0) throw new Error("interlaced PNG")
      header = {
        width: view.getUint32(at + 8, false),
        height: view.getUint32(at + 12, false),
        channels: colour === 6 ? 4 : 3,
      }
    }
    if (kind === "IDAT") parts.push(new Uint8Array(body))
    if (kind === "IEND") break
    at += 12 + length
  }
  if (header === undefined) throw new Error("PNG without IHDR")
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let written = 0
  for (const part of parts) {
    joined.set(part, written)
    written += part.length
  }
  return unfilter(Bun.inflateSync(joined), header)
}

function unfilter(raw: Uint8Array, header: { width: number; height: number; channels: number }): Raster {
  const { width, height, channels } = header
  const stride = width * channels
  const rgba = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  let at = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[at]
    at += 1
    for (let index = 0; index < stride; index += 1) {
      const value = raw[at + index] ?? 0
      const left = index >= channels ? (line[index - channels] ?? 0) : 0
      const up = previous[index] ?? 0
      const upLeft = index >= channels ? (previous[index - channels] ?? 0) : 0
      line[index] = (value + reconstruct(filter ?? 0, left, up, upLeft)) & 0xff
    }
    at += stride
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      rgba[target] = line[source] ?? 0
      rgba[target + 1] = line[source + 1] ?? 0
      rgba[target + 2] = line[source + 2] ?? 0
      rgba[target + 3] = channels === 4 ? (line[source + 3] ?? 255) : 255
    }
    previous.set(line)
  }
  return { width, height, rgba }
}

function reconstruct(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return up
    case 3:
      return (left + up) >> 1
    case 4: {
      const estimate = left + up - upLeft
      const dl = Math.abs(estimate - left)
      const du = Math.abs(estimate - up)
      const dul = Math.abs(estimate - upLeft)
      return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft
    }
    default:
      throw new Error(`PNG filter ${filter} is not 0..4`)
  }
}
