// A minimal PNG reader for the engine's own frames (8-bit RGB or RGBA, non-interlaced), enough to
// read marker pixels back without a dependency.
import { inflateSync } from "node:zlib"

type Pixels = { readonly width: number; readonly height: number; readonly at: (x: number, y: number) => [number, number, number] }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function readPng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const data: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const colour = body[9]
      if (body[8] !== 8 || body[12] !== 0 || (colour !== 2 && colour !== 6)) throw new Error("unsupported PNG layout")
      channels = colour === 6 ? 4 : 3
    } else if (type === "IDAT") data.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? out[y * stride + x - channels] : 0
      const up = y > 0 ? out[(y - 1) * stride + x] : 0
      const corner = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter] ?? 0
      out[y * stride + x] = (value + predictor) & 0xff
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const index = (y * width + x) * channels
      return [out[index], out[index + 1], out[index + 2]]
    },
  }
}
