import type { DecodedPng } from "./png-decode"

export interface IconMetrics {
  readonly distinctColors: number
  readonly lightRatio: number
  readonly transparentRatio: number
  readonly opaque: boolean
  readonly cornerAlphas: readonly [number, number, number, number]
  readonly glyphRadius: number
}

const LIGHT_CHANNEL_FLOOR = 128
const OPAQUE = 0xff

function channelAt(image: DecodedPng, x: number, y: number, channel: number): number {
  const value = image.pixels[(y * image.width + x) * 4 + channel]
  if (value === undefined) throw new RangeError(`pixel (${x}, ${y}) is outside the image`)
  return value
}

function isLight(r: number, g: number, b: number, a: number): boolean {
  return a > 0 && r >= LIGHT_CHANNEL_FLOOR && g >= LIGHT_CHANNEL_FLOOR && b >= LIGHT_CHANNEL_FLOOR
}

/**
 * Measures what the icon contract asserts on: visible artwork (light pixels of the glyph on
 * the dark field), transparency, and how far the glyph reaches from the centre as a fraction
 * of the width, which is what a launcher's maskable safe zone constrains.
 */
export function measureIcon(image: DecodedPng): IconMetrics {
  const { width, height } = image
  const total = width * height
  const centreX = (width - 1) / 2
  const centreY = (height - 1) / 2
  const colors = new Set<number>()
  let light = 0
  let transparent = 0
  let opaque = true
  let farthest = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = channelAt(image, x, y, 0)
      const g = channelAt(image, x, y, 1)
      const b = channelAt(image, x, y, 2)
      const a = channelAt(image, x, y, 3)
      colors.add(((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
      if (a === 0) transparent++
      if (a !== OPAQUE) opaque = false
      if (isLight(r, g, b, a)) {
        light++
        farthest = Math.max(farthest, Math.hypot(x - centreX, y - centreY))
      }
    }
  }
  return {
    distinctColors: colors.size,
    lightRatio: light / total,
    transparentRatio: transparent / total,
    opaque,
    cornerAlphas: [
      channelAt(image, 0, 0, 3),
      channelAt(image, width - 1, 0, 3),
      channelAt(image, 0, height - 1, 3),
      channelAt(image, width - 1, height - 1, 3),
    ],
    glyphRadius: farthest / width,
  }
}
