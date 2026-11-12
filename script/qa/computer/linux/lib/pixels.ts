// The independent pixel oracle: `xwd -root` decoded here, and the engine's PNG decoded by
// `convert`-free means (Bun's own PNG decoder is not available, so the frame is compared
// through its own decoder in `png.ts`). Nothing here reads the engine's report.

/** One decoded image: RGBA bytes, four per pixel. */
export interface Raster {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export function pixelAt(raster: Raster, x: number, y: number): [number, number, number] {
  const at = (y * raster.width + x) * 4
  return [raster.rgba[at] ?? 0, raster.rgba[at + 1] ?? 0, raster.rgba[at + 2] ?? 0]
}

export function countColour(raster: Raster, rgb: readonly [number, number, number], tolerance = 8): number {
  let count = 0
  for (let at = 0; at < raster.rgba.length; at += 4) {
    const near =
      Math.abs((raster.rgba[at] ?? 0) - rgb[0]) <= tolerance &&
      Math.abs((raster.rgba[at + 1] ?? 0) - rgb[1]) <= tolerance &&
      Math.abs((raster.rgba[at + 2] ?? 0) - rgb[2]) <= tolerance
    if (near) count += 1
  }
  return count
}

const XWD_HEADER_WORDS = 25

/**
 * Decodes an `xwd` dump (X11 window-dump format, MSB-first header words). Only the
 * TrueColor ZPixmap form Xvfb and Xorg write is supported; anything else throws, so a
 * decoding slip can never pass as a pixel fact.
 */
export function decodeXwd(bytes: Uint8Array): Raster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (index: number): number => view.getUint32(index * 4, false)
  const headerSize = word(0)
  if (word(1) !== 7) throw new Error(`xwd file version ${word(1)} is not 7`)
  if (word(2) !== 2) throw new Error(`xwd format ${word(2)} is not ZPixmap`)
  const width = word(4)
  const height = word(5)
  const bitsPerPixel = word(12)
  const bytesPerLine = word(13)
  const masks: [number, number, number] = [word(21), word(22), word(23)]
  const byteOrder = word(7)
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new Error(`xwd ${bitsPerPixel} bits per pixel`)
  if (headerSize < XWD_HEADER_WORDS * 4) throw new Error(`xwd header of ${headerSize} bytes is too short`)
  const step = bitsPerPixel / 8
  const pixels = bytes.subarray(headerSize + word(19) * 12)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * bytesPerLine + x * step
      let value = 0
      for (let index = 0; index < step; index += 1) {
        const byte = pixels[start + (byteOrder === 1 ? index : step - 1 - index)] ?? 0
        value = (value << 8) | byte
      }
      const at = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[at + channel] = extract(value >>> 0, masks[channel] ?? 0)
      }
      rgba[at + 3] = 255
    }
  }
  return { width, height, rgba }
}

function extract(value: number, mask: number): number {
  if (mask === 0) return 0
  const shift = Math.log2(mask & -mask)
  const bits = ((mask >>> shift) >>> 0).toString(2).replace(/0/g, "").length
  const raw = (value & mask) >>> shift
  const max = (1 << bits) - 1
  return Math.round((raw * 255) / max)
}
