// A fully covered window is still captured through its own Composite pixmap: the engine's
// window frame shows zero occluder pixels while the independent root oracle sees the
// occluder on screen - the occlusion the model needs and a root crop cannot give.
import { countColour, type Raster } from "../lib/pixels.ts"
import { decodePng } from "../lib/png.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"
import { fixtureWindow, rootOracle, windowGeometry, windowId } from "./shared.ts"

const TARGET = { title: "r47-under", width: 200, height: 120, background: "green" } as const
const OCCLUDER = { title: "r47-over", background: "magenta" } as const
const GREEN: readonly [number, number, number] = [0, 128, 0]
const MAGENTA: readonly [number, number, number] = [255, 0, 255]

export const occluderOracle: Scenario = {
  name: "occluder-oracle",
  admit: "os",
  sessions: ["xvfb"],
  async run(ctx: Context): Promise<Checked> {
    const { engine, procs, stage } = ctx
    procs.start("under-window", fixtureWindow({ ...TARGET, markers: [] }), stage.env)
    const under = await windowId(ctx, TARGET.title)
    const underGeometry = await windowGeometry(ctx, under)

    procs.start(
      "occluder-window",
      fixtureWindow({
        title: OCCLUDER.title,
        width: underGeometry.width,
        height: underGeometry.height,
        background: OCCLUDER.background,
        markers: [],
      }),
      stage.env,
    )
    const over = await windowId(ctx, OCCLUDER.title)
    await procs.stdout(
      ["xdotool", "windowmove", over, String(underGeometry.x), String(underGeometry.y), "windowactivate", over],
      stage.env,
    )

    const oracle = await rootOracle(ctx, "occluder-oracle")
    const oracleMagenta = countColour(oracle, MAGENTA)

    await engine.open("os", "null")
    const listed = (await engine.call("windows", {})) as { id: string; title: string }[]
    const target = listed.find((entry) => entry.title === TARGET.title)
    const capture = (await engine.call("capture", { target: target?.id ?? under, cursor: false })) as {
      data: string
    }
    const frame: Raster = decodePng(new Uint8Array(Buffer.from(capture.data ?? "", "base64")))
    const frameMagenta = countColour(frame, MAGENTA)
    const frameGreen = countColour(frame, GREEN)

    return {
      checks: {
        occluder_is_on_screen_for_the_oracle: oracleMagenta > 0,
        window_frame_has_zero_occluder_pixels: frameMagenta === 0,
        window_frame_shows_the_covered_window: frameGreen > 0,
        window_frame_size_matches_the_window:
          frame.width === underGeometry.width && frame.height === underGeometry.height,
      },
      facts: {
        occluder_pixels_oracle: oracleMagenta,
        occluder_pixels_frame: frameMagenta,
        covered_pixels_frame: frameGreen,
        window: underGeometry,
        frame: { width: frame.width, height: frame.height },
        input_sent: 0,
      },
      observer: { before: { magenta: oracleMagenta }, after: { magenta: frameMagenta, green: frameGreen } },
    }
  },
}
