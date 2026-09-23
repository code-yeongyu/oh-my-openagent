/// <reference types="bun" />
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import manifest from "../app/manifest"
import {
  buildIconSvg,
  ICON_OUTPUTS,
  ICON_SOURCE,
  IconSourceError,
  MASKABLE_GLYPH_SCALE,
  MASKABLE_SAFE_ZONE_RADIUS,
  renderIcon,
} from "./app-icons"
import { measureIcon } from "./icon-metrics"
import { decodePng } from "./png-decode"

const WEB_ROOT = join(import.meta.dir, "..")
const INSTALLABLE_SIZES = ["192x192", "512x512"]
const ARTWORK_FLOOR = 0.1

const source = readFileSync(join(WEB_ROOT, ICON_SOURCE), "utf8")
const icons = manifest().icons ?? []

function committedBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(WEB_ROOT, file)))
}

describe("manifest icons", () => {
  test.each(["any", "maskable"] as const)(
    "ships PNG icons with purpose %s at 192 and 512 for installability",
    (purpose) => {
      const sizes = icons
        .filter((icon) => icon.type === "image/png" && icon.purpose === purpose)
        .map((icon) => icon.sizes)
      expect(sizes).toEqual(expect.arrayContaining(INSTALLABLE_SIZES))
    },
  )

  test("every manifest icon points at a file under public/ or app/ with its declared size", () => {
    for (const icon of icons) {
      const relative = icon.src.replace(/^\//, "")
      const candidates = [join(WEB_ROOT, "public", relative), join(WEB_ROOT, "app", relative)]
      const file = candidates.find((candidate) => existsSync(candidate))
      expect(file, `${icon.src} is not served from public/ or app/`).toBeDefined()
      if (icon.type !== "image/png" || !file) continue
      const declared = /^(\d+)x(\d+)$/.exec(icon.sizes ?? "")
      expect(declared, `${icon.src} declares no WxH size`).not.toBeNull()
      if (!declared) continue
      const { width, height } = decodePng(new Uint8Array(readFileSync(file)))
      expect({ width, height }).toEqual({ width: Number(declared[1]), height: Number(declared[2]) })
    }
  })
})

describe("committed icon rasters", () => {
  test.each([...ICON_OUTPUTS])("$file is a fresh render of app/icon.svg", async (output) => {
    const rendered = await renderIcon(source, output)
    expect(
      Buffer.compare(committedBytes(output.file), rendered.png),
      `${output.file} differs from a fresh render; run \`bun run icons:render\``,
    ).toBe(0)
  })

  test.each([...ICON_OUTPUTS])("$file shows the OmO mark at $size px", (output) => {
    const image = decodePng(committedBytes(output.file))
    const metrics = measureIcon(image)
    expect({ width: image.width, height: image.height }).toEqual({
      width: output.size,
      height: output.size,
    })
    expect(metrics.distinctColors, `${output.file} is a flat fill`).toBeGreaterThan(2)
    expect(metrics.lightRatio, `${output.file} has no visible artwork`).toBeGreaterThan(
      ARTWORK_FLOOR,
    )
  })

  test.each(ICON_OUTPUTS.filter((output) => output.purpose !== "any"))(
    "$file is fully opaque so the platform mask sees a full-bleed field",
    (output) => {
      expect(measureIcon(decodePng(committedBytes(output.file))).opaque).toBe(true)
    },
  )

  test.each(ICON_OUTPUTS.filter((output) => output.purpose === "any"))(
    "$file keeps transparent rounded corners",
    (output) => {
      const metrics = measureIcon(decodePng(committedBytes(output.file)))
      expect(metrics.cornerAlphas).toEqual([0, 0, 0, 0])
      expect(metrics.transparentRatio).toBeGreaterThan(0)
    },
  )

  test.each(ICON_OUTPUTS.filter((output) => output.purpose === "maskable"))(
    "$file keeps the glyph inside the maskable safe zone",
    (output) => {
      const metrics = measureIcon(decodePng(committedBytes(output.file)))
      expect(metrics.glyphRadius).toBeLessThanOrEqual(MASKABLE_SAFE_ZONE_RADIUS)
    },
  )
})

describe("icon source variants", () => {
  test("any keeps the source mark untouched", () => {
    expect(buildIconSvg(source, "any")).toBe(source)
  })

  test("apple-touch squares off the field", () => {
    expect(buildIconSvg(source, "apple-touch")).toContain('rx="0"')
  })

  test("maskable squares off the field and shrinks the glyph", () => {
    const svg = buildIconSvg(source, "maskable")
    expect(svg).toContain('rx="0"')
    expect(svg).toContain(`scale(${MASKABLE_GLYPH_SCALE})`)
  })

  test("rejects a source without the field rect and glyph group", () => {
    expect(() => buildIconSvg("<svg/>", "any")).toThrow(IconSourceError)
  })

  test("decodePng reproduces the renderer's pixels for an opaque icon", async () => {
    const rendered = await renderIcon(source, ICON_OUTPUTS[0])
    const decoded = decodePng(rendered.png)
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: rendered.width,
      height: rendered.height,
    })
    expect(Buffer.compare(decoded.pixels, rendered.pixels)).toBe(0)
  })

  test("decodePng reproduces the renderer's alpha channel for a transparent icon", async () => {
    // The renderer exposes premultiplied pixels, so only alpha is comparable where alpha < 255.
    const rendered = await renderIcon(source, ICON_OUTPUTS[1])
    const decoded = decodePng(rendered.png)
    const alpha = (pixels: Uint8Array) => pixels.filter((_, index) => index % 4 === 3)
    expect(Buffer.compare(alpha(decoded.pixels), alpha(rendered.pixels))).toBe(0)
  })
})
