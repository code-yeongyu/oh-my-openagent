// With `DISPLAY` unset the engine reports no display server: every verb that needs a
// backend is refused `Internal` with `data.reason` `no_display_server` (the wire form; the
// model-facing `COMPUTER_UNAVAILABLE` member and `nextCall` come from the SDK mapper of the
// error-table row), nothing is sent, and no input reaches the machine.
import type { EngineError, JsonObject } from "../lib/engine.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"

function raw(error: EngineError | undefined): JsonObject {
  if (error === undefined) return { answered: true }
  return { code: error.code, data: error.data }
}

function refusedNoDisplay(error: EngineError | undefined): boolean {
  return error !== undefined && error.code === "Internal" && (error.data.reason ?? "") === "no_display_server"
}

export const noDisplay: Scenario = {
  name: "no-display",
  admit: "none",
  sessions: ["none"],
  requires: [],
  async run(ctx: Context): Promise<Checked> {
    const { engine } = ctx
    await engine.open("none")

    const capabilities = (await engine.call("capabilities")) as {
      backend: string
      capture: { available: boolean; reason?: string }
      windowCapture: { available: boolean; reason?: string }
    }
    const capture = await engine.refusal("capture", { target: "desktop", cursor: false })
    const displays = await engine.refusal("displays", {})

    return {
      checks: {
        backend_is_x11: capabilities.backend === "x11",
        capture_reports_no_display_server: capabilities.capture.reason === "no_display_server",
        window_capture_reports_no_display_server: capabilities.windowCapture.reason === "no_display_server",
        capture_refused_internal_no_display_server: refusedNoDisplay(capture),
        displays_refused_internal_no_display_server: refusedNoDisplay(displays),
      },
      facts: {
        capabilities,
        refusals: { capture: raw(capture), displays: raw(displays) },
        input_sent: 0,
      },
      observer: { before: {}, after: { backend: capabilities.backend } },
    }
  },
}
