// Shared scenario plumbing: the fixture window, the independent xwd oracle, and the
// marker lookup every pixel-asserting scenario reads. Nothing here reads the engine's
// own report.
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { Context } from "../lib/scenario.ts"
import { type Raster, pixelAt } from "../lib/pixels.ts"

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url))
export const MARKER: readonly [number, number, number] = [255, 0, 0]

/** The fixture window binary and its argv for one window. */
export function fixtureWindow(options: {
  title: string
  width: number
  height: number
  background: string
  markers: readonly string[]
}): string[] {
  const argv = [
    "python3",
    join(FIXTURES, "marker-window.py"),
    "--title",
    options.title,
    "--width",
    String(options.width),
    "--height",
    String(options.height),
    "--background",
    options.background,
  ]
  for (const marker of options.markers) argv.push("--marker", marker)
  return argv
}

/** The first window whose name matches `title`, as `xdotool` (the oracle) reports it. */
export async function windowId(ctx: Context, title: string): Promise<string> {
  const listed = await ctx.procs.stdout(["xdotool", "search", "--name", title], ctx.stage.env)
  return listed.split("\n")[0] ?? ""
}

/** `(x, y, width, height)` of a window, as `xdotool` (the oracle) reports them. */
export async function windowGeometry(
  ctx: Context,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const shell = await ctx.procs.stdout(["xdotool", "getwindowgeometry", "--shell", id], ctx.stage.env)
  const values = new Map<string, string>()
  for (const line of shell.split("\n")) {
    const [key, value] = line.split("=")
    if (key !== undefined && value !== undefined) values.set(key.trim(), value.trim())
  }
  return {
    x: Number(values.get("X")),
    y: Number(values.get("Y")),
    width: Number(values.get("WIDTH")),
    height: Number(values.get("HEIGHT")),
  }
}

/** `xwd -root` decoded - the independent pixel oracle, never the engine's numbers. */
export async function rootOracle(ctx: Context, name: string): Promise<Raster> {
  const dump = join(ctx.stage.runDir, `${name}.xwd`)
  await ctx.procs.stdout(["xwd", "-root", "-out", dump], ctx.stage.env)
  const { decodeXwd } = await import("../lib/pixels.ts")
  return decodeXwd(new Uint8Array(await readFile(dump)))
}

/** The first pixel of `marker` colour in `raster`, top-left first. */
export function findMarker(raster: Raster, marker: readonly [number, number, number]): [number, number] {
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const [r, g, b] = pixelAt(raster, x, y)
      if (r === marker[0] && g === marker[1] && b === marker[2]) return [x, y]
    }
  }
  return [-1, -1]
}
