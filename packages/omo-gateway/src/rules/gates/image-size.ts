import { readFile } from "node:fs/promises"

export interface ImageSize {
  readonly width: number
  readonly height: number
}

export type ImageFormat = "png" | "jpeg" | "gif" | "webp"

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

export function looksLikeImage(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

function formatOf(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif"
  const riff = String.fromCharCode(...bytes.subarray(0, 4)) + String.fromCharCode(...bytes.subarray(8, 12))
  return riff === "RIFFWEBP" ? "webp" : null
}

function jpegSize(view: DataView): ImageSize | null {
  let at = 2
  while (at + 9 < view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null
    const marker = view.getUint8(at + 1)
    const length = view.getUint16(at + 2)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) }
    at += 2 + length
  }
  return null
}

function webpSize(view: DataView): ImageSize | null {
  const chunk = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))
  if (chunk === "VP8X") {
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16))
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16))
    return { width, height }
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  return null
}

/** Pixel size from an image's header bytes, or null when the bytes are not a PNG/JPEG/GIF/WebP it can read. */
export function imageSizeOf(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    switch (formatOf(bytes)) {
      case "png":
        return { width: view.getUint32(16), height: view.getUint32(20) }
      case "gif":
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
      case "jpeg":
        return jpegSize(view)
      case "webp":
        return webpSize(view)
      case null:
        return null
    }
  } catch {
    return null
  }
}

export async function readImageSize(path: string): Promise<ImageSize | null> {
  return imageSizeOf(new Uint8Array(await readFile(path)))
}
