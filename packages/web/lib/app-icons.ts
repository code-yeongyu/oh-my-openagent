import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"

import { initWasm, Resvg } from "@resvg/resvg-wasm"

import type { DecodedPng } from "./png-decode"

export type IconPurpose = "any" | "maskable" | "apple-touch"

export interface IconOutput {
  readonly file: string
  readonly size: number
  readonly purpose: IconPurpose
}

export const ICON_SOURCE = "app/icon.svg"

/**
 * Launchers mask a `maskable` icon to a circle whose radius is 40% of the icon (the W3C safe
 * zone). At the source glyph scale of 0.82 the cat's ear tips reach 40.4% from the centre, so
 * the maskable variant shrinks the glyph to 0.72 (about 35.5%) to stay inside with margin.
 */
export const MASKABLE_GLYPH_SCALE = 0.72
export const MASKABLE_SAFE_ZONE_RADIUS = 0.4

export const ICON_OUTPUTS = [
  // iOS composes its own rounded mask over apple-touch icons, so this one is an opaque square.
  { file: "app/apple-icon.png", size: 180, purpose: "apple-touch" },
  { file: "public/icon-192x192.png", size: 192, purpose: "any" },
  { file: "public/icon-512x512.png", size: 512, purpose: "any" },
  { file: "public/icon-maskable-192x192.png", size: 192, purpose: "maskable" },
  { file: "public/icon-maskable-512x512.png", size: 512, purpose: "maskable" },
] as const satisfies readonly IconOutput[]

export class IconSourceError extends Error {
  constructor(readonly source: string) {
    super(`${source} no longer has the 1024 field rect and glyph group the icon renderer expects`)
    this.name = "IconSourceError"
  }
}

const SOURCE_CANVAS = 1024
const FIELD_RECT = /<rect width="1024" height="1024" rx="[\d.]+" fill="#0a0a0a"\s*\/>/
const GLYPH_GROUP = /<g transform="translate\([\d.]+ [\d.]+\) scale\([\d.]+\)">/

export function buildIconSvg(source: string, purpose: IconPurpose): string {
  if (!FIELD_RECT.test(source) || !GLYPH_GROUP.test(source)) throw new IconSourceError(ICON_SOURCE)
  if (purpose === "any") return source
  const fullBleed = source.replace(FIELD_RECT, (rect) => rect.replace(/rx="[\d.]+"/, 'rx="0"'))
  if (purpose === "apple-touch") return fullBleed
  const inset = (SOURCE_CANVAS * (1 - MASKABLE_GLYPH_SCALE)) / 2
  return fullBleed.replace(
    GLYPH_GROUP,
    `<g transform="translate(${inset} ${inset}) scale(${MASKABLE_GLYPH_SCALE})">`,
  )
}

export interface RenderedIcon extends DecodedPng {
  readonly png: Uint8Array
}

let wasmReady: Promise<void> | undefined

function ensureWasm(): Promise<void> {
  wasmReady ??= readFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"))
    .then((wasm) => initWasm(wasm))
    .then(() => undefined)
  return wasmReady
}

export async function renderIcon(source: string, output: IconOutput): Promise<RenderedIcon> {
  await ensureWasm()
  const resvg = new Resvg(buildIconSvg(source, output.purpose), {
    fitTo: { mode: "width", value: output.size },
  })
  try {
    const image = resvg.render()
    try {
      return {
        width: image.width,
        height: image.height,
        pixels: Uint8Array.from(image.pixels),
        png: image.asPng(),
      }
    } finally {
      image.free()
    }
  } finally {
    resvg.free()
  }
}
