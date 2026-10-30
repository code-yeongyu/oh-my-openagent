import { readFileSync } from "node:fs"

/**
 * Reads the DESIGN.md §2 colour tokens from the stylesheet the site ships
 * (`app/styles/design-system.css` `:root`) and computes WCAG 2.2 contrast, so token
 * pairs are checked against the real values instead of a copy.
 */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const STYLESHEET = new URL("../app/styles/design-system.css", import.meta.url)

export function readRootTokens(
  css: string = readFileSync(STYLESHEET, "utf8"),
): ReadonlyMap<string, string> {
  const start = css.indexOf(":root {")
  if (start === -1) throw new Error("design-system.css has no :root block")
  const block = css.slice(start, css.indexOf("}", start))
  const tokens = new Map<string, string>()
  for (const match of block.matchAll(/(?<name>--[\w-]+)\s*:\s*(?<value>[^;]+);/g)) {
    const { name, value } = match.groups ?? {}
    if (name !== undefined && value !== undefined) tokens.set(name, value.trim())
  }
  return tokens
}

function parseColor(value: string): Rgba {
  const hex = /^#(?<digits>[0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.groups?.digits
  if (hex !== undefined) {
    const digits = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    }
  }
  const rgb =
    /^rgba?\(\s*(?<r>[\d.]+)\s*,\s*(?<g>[\d.]+)\s*,\s*(?<b>[\d.]+)\s*(?:,\s*(?<a>[\d.]+)\s*)?\)$/.exec(
      value,
    )?.groups
  if (rgb !== undefined) {
    return { r: Number(rgb.r), g: Number(rgb.g), b: Number(rgb.b), a: Number(rgb.a ?? 1) }
  }
  throw new Error(`unsupported colour value: ${value}`)
}

export function resolveColor(tokens: ReadonlyMap<string, string>, name: string): Rgba {
  const seen = new Set<string>()
  let current = name
  for (;;) {
    if (seen.has(current)) throw new Error(`token cycle at ${current}`)
    seen.add(current)
    const value = tokens.get(current)
    if (value === undefined) throw new Error(`unknown token ${current}`)
    const reference = /^var\((?<name>--[\w-]+)\)$/.exec(value)?.groups?.name
    if (reference === undefined) return parseColor(value)
    current = reference
  }
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  }
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const srgb = value / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.2 contrast ratio; a translucent foreground is composited over the opaque background. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  if (background.a !== 1) throw new Error("the background of a contrast pair must be opaque")
  const lighter = luminance(composite(foreground, background))
  const darker = luminance(background)
  const [high, low] = lighter > darker ? [lighter, darker] : [darker, lighter]
  return (high + 0.05) / (low + 0.05)
}
