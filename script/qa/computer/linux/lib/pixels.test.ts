// The xwd oracle is decoded from a dump built in X11/XWDFile.h's own field order (named
// fields, not indices), with a window name, a colormap and padded rows, so a decoder that
// reads the wrong header word cannot agree with its own fixture.
import { expect, test } from "bun:test"

import { decodeXwd, pixelAt } from "./pixels.ts"

const FIELDS = [
  "header_size",
  "file_version",
  "pixmap_format",
  "pixmap_depth",
  "pixmap_width",
  "pixmap_height",
  "xoffset",
  "byte_order",
  "bitmap_unit",
  "bitmap_bit_order",
  "bitmap_pad",
  "bits_per_pixel",
  "bytes_per_line",
  "visual_class",
  "red_mask",
  "green_mask",
  "blue_mask",
  "bits_per_rgb",
  "colormap_entries",
  "ncolors",
  "window_width",
  "window_height",
  "window_x",
  "window_y",
  "window_bdrwidth",
] as const

function dump(pixels: readonly (readonly [number, number, number])[], width: number, byteOrder: 0 | 1): Uint8Array {
  const name = new TextEncoder().encode("xwdump\0")
  const headerSize = FIELDS.length * 4 + name.length
  const ncolors = 2
  const bytesPerLine = width * 4 + 8
  const height = pixels.length / width
  const values: Record<(typeof FIELDS)[number], number> = {
    header_size: headerSize,
    file_version: 7,
    pixmap_format: 2,
    pixmap_depth: 24,
    pixmap_width: width,
    pixmap_height: height,
    xoffset: 0,
    byte_order: byteOrder,
    bitmap_unit: 32,
    bitmap_bit_order: byteOrder,
    bitmap_pad: 32,
    bits_per_pixel: 32,
    bytes_per_line: bytesPerLine,
    visual_class: 4,
    red_mask: 0xff0000,
    green_mask: 0x00ff00,
    blue_mask: 0x0000ff,
    bits_per_rgb: 8,
    colormap_entries: 256,
    ncolors,
    window_width: width,
    window_height: height,
    window_x: 5,
    window_y: 7,
    window_bdrwidth: 0,
  }
  const out = new Uint8Array(headerSize + ncolors * 12 + bytesPerLine * height)
  const view = new DataView(out.buffer)
  FIELDS.forEach((field, index) => view.setUint32(index * 4, values[field], false))
  out.set(name, FIELDS.length * 4)
  const base = headerSize + ncolors * 12
  pixels.forEach(([r, g, b], at) => {
    const value = (r << 16) | (g << 8) | b
    view.setUint32(base + Math.floor(at / width) * bytesPerLine + (at % width) * 4, value, byteOrder === 0)
  })
  return out
}

test("a 32-bit TrueColor dump decodes to its pixels in both byte orders, past the name, colormap and row padding", () => {
  const pixels = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
  ] as const
  for (const order of [0, 1] as const) {
    const raster = decodeXwd(dump(pixels, 2, order))
    expect([raster.width, raster.height]).toEqual([2, 2])
    expect(pixelAt(raster, 0, 0)).toEqual([255, 0, 0])
    expect(pixelAt(raster, 1, 0)).toEqual([0, 255, 0])
    expect(pixelAt(raster, 0, 1)).toEqual([0, 0, 255])
    expect(pixelAt(raster, 1, 1)).toEqual([255, 0, 255])
  }
})
