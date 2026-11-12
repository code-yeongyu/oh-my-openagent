// With `Xft.dpi: 192` the reported scale is 2, the frame is twice the logical size, and
// the fixture's marker pixel sits at the scaled coordinate the independent oracle
// (`xwd -root` decoded) reports. No input is sent in this scenario.
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { decodePng } from "../lib/png.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"
import { findMarker, fixtureWindow, MARKER, rootOracle, windowGeometry, windowId } from "./shared.ts"

const LOGICAL = { width: 100, height: 60, marker: [10, 8] as const }
const WINDOW_AT = { x: 40, y: 30 } as const
const TITLE = "r47-scale-marker"

export const xftDpiScale: Scenario = {
  name: "xft-dpi-scale",
  admit: "os",
  sessions: ["xvfb"],
  requires: ["xdotool", "xrdb", "xwd"],
  async run(ctx: Context): Promise<Checked> {
    const { engine, procs, stage } = ctx
    await writeFile(join(stage.runDir, "resources"), "Xft.dpi: 192\n", "utf8")
    await procs.stdout(["xrdb", "-merge", join(stage.runDir, "resources")], stage.env)
    procs.start(
      "marker-window",
      fixtureWindow({
        title: TITLE,
        width: LOGICAL.width,
        height: LOGICAL.height,
        background: "white",
        markers: [`${LOGICAL.marker[0]},${LOGICAL.marker[1]}@red`],
      }),
      stage.env,
    )
    const id = await windowId(ctx, TITLE)
    await procs.stdout(["xdotool", "windowmove", id, String(WINDOW_AT.x), String(WINDOW_AT.y)], stage.env)
    const geometry = await windowGeometry(ctx, id)

    const oracle = await rootOracle(ctx, "xft-dpi-scale")
    const oracleMarker = findMarker(oracle, MARKER)

    await engine.open("os", "null")
    const displays = (await engine.call("displays")) as { scale: number; bounds: { width: number } }[]
    const capture = (await engine.call("capture", { target: "desktop", cursor: false })) as {
      data: string
      width: number
      height: number
    }
    const frame = decodePng(new Uint8Array(Buffer.from(capture.data ?? "", "base64")))
    const frameMarker = findMarker(frame, MARKER)

    const scale = displays[0]?.scale ?? 0
    const expectedMarker = [WINDOW_AT.x + LOGICAL.marker[0] * 2, WINDOW_AT.y + LOGICAL.marker[1] * 2] as const
    return {
      checks: {
        reported_scale_is_2: scale === 2,
        window_renders_at_twice_its_logical_size:
          geometry.width === LOGICAL.width * 2 && geometry.height === LOGICAL.height * 2,
        oracle_sees_marker_at_scaled_coordinate:
          oracleMarker[0] === expectedMarker[0] && oracleMarker[1] === expectedMarker[1],
        frame_is_twice_the_logical_display:
          displays[0] !== undefined && capture.width === (displays[0]?.bounds.width ?? 0) * 2,
        frame_marker_matches_oracle: frameMarker[0] === oracleMarker[0] && frameMarker[1] === oracleMarker[1],
      },
      facts: {
        scale,
        window: geometry,
        oracle_marker: oracleMarker,
        frame_marker: frameMarker,
        frame: { width: capture.width, height: capture.height },
        input_sent: 0,
      },
      observer: { before: { marker: oracleMarker, window: geometry }, after: { marker: frameMarker } },
    }
  },
}
