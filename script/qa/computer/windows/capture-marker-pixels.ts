// Row 55 happy path: the engine captures the display under the driver's own four-colour window;
// the frame carries the four marker colours at the physical (DPI-scaled) coordinates the window's
// own process reports, and the display list reports that monitor with its scale. No input is sent
// and no overlay is involved.
import type { Engine } from "./engine.ts"
import { openMarker } from "./marker.ts"
import { readPng } from "./png.ts"
import { register, type Outcome } from "./scenario.ts"

type Display = {
  readonly id: string
  readonly bounds: { x: number; y: number; width: number; height: number }
  readonly scale: number
}
type Frame = {
  readonly data?: string
  readonly artifactPath?: string | null
  readonly width: number
  readonly height: number
}

const TOLERANCE = 8

async function frameBytes(frame: Frame): Promise<Uint8Array> {
  if (typeof frame.data === "string" && frame.data !== "") return Buffer.from(frame.data, "base64")
  if (typeof frame.artifactPath === "string") return new Uint8Array(await Bun.file(frame.artifactPath).arrayBuffer())
  throw new Error("the frame carries neither inline data nor an artifact")
}

async function run(engine: Engine): Promise<Outcome> {
  const marker = await openMarker()
  try {
    const listed = await engine.call("displays")
    if (listed.error !== undefined)
      return { pass: false, facts: { displays: listed.error }, receipts: [await marker.close()] }
    const displays = listed.result as Display[]
    const cx = marker.x + marker.width / 2
    const cy = marker.y + marker.height / 2
    const display = displays.find(
      ({ bounds }) => cx >= bounds.x && cx < bounds.x + bounds.width && cy >= bounds.y && cy < bounds.y + bounds.height,
    )
    if (display === undefined) return { pass: false, facts: { displays, marker }, receipts: [await marker.close()] }
    const captured = await engine.call("capture", { target: `display:${display.id}` })
    if (captured.error !== undefined)
      return { pass: false, facts: { capture: captured.error }, receipts: [await marker.close()] }
    const frame = captured.result as Frame
    const pixels = readPng(await frameBytes(frame))
    const quadrants = marker.colours.map((expected, index) => {
      const x = Math.round(marker.x - display.bounds.x + (index % 2 === 0 ? 0.25 : 0.75) * marker.width)
      const y = Math.round(marker.y - display.bounds.y + (index < 2 ? 0.25 : 0.75) * marker.height)
      const seen = pixels.at(x, y)
      const ok = seen.every((channel, c) => Math.abs(channel - expected[c]) <= TOLERANCE)
      return { x, y, expected, seen, ok }
    })
    const scaleOk = Math.abs(display.scale - marker.dpi / 96) < 1e-9
    const physical = pixels.width === display.bounds.width && pixels.height === display.bounds.height
    const facts = {
      display: display.id,
      scale: display.scale,
      dpi: marker.dpi,
      frame: [pixels.width, pixels.height],
      physical,
      quadrants,
    }
    return { pass: scaleOk && physical && quadrants.every(({ ok }) => ok), facts, receipts: [await marker.close()] }
  } catch (error) {
    return { pass: false, facts: { error: String(error) }, receipts: [await marker.close()] }
  }
}

register({ name: "capture-marker-pixels", admit: "none", run })
