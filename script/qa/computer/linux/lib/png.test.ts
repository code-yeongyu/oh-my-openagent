// The engine's PNG frames carry zlib-wrapped IDAT data (RFC 1950), so the reader must inflate
// a zlib stream, not raw DEFLATE; the fixture is built with a real zlib encoder.
import { deflateSync } from "node:zlib"
import { expect, test } from "bun:test"

import { pixelAt } from "./pixels.ts"
import { decodePng } from "./png.ts"

function chunk(kind: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length, false)
  out.set(new TextEncoder().encode(kind), 4)
  out.set(body, 8)
  return out
}

function png(width: number, rows: readonly (readonly number[])[]): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, rows.length, false)
  header.set([8, 6, 0, 0, 0], 8)
  const raw = rows.flatMap((row) => [0, ...row])
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(raw)))),
    chunk("IEND", new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

test("a PNG whose IDAT is a zlib stream decodes to its pixels", () => {
  const raster = decodePng(png(2, [[255, 0, 0, 255, 0, 255, 0, 255]]))
  expect([raster.width, raster.height]).toEqual([2, 1])
  expect(pixelAt(raster, 0, 0)).toEqual([255, 0, 0])
  expect(pixelAt(raster, 1, 0)).toEqual([0, 255, 0])
})
