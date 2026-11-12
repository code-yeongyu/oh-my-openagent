// With `DISPLAY` unset the engine reports no display server: every verb that needs a
// backend answers `COMPUTER_UNAVAILABLE` (`no_display_server`, not delivered, nothing
// sent) with `nextCall computer.diagnose({ hand })`, and nothing reaches the machine.
import type { EngineError } from "../lib/engine.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"

export const noDisplay: Scenario = {
  admit: "none",
  sessions: ["none"],
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
    const zoom = await engine.refusal("zoom", { target: "desktop" })

    const unavailable = (refusal: EngineError | undefined): boolean =>
      refusal !== undefined &&
      refusal.code === "COMPUTER_UNAVAILABLE" &&
      (refusal.data.reason ?? "") === "no_display_server"

    return {
      checks: {
        backend_is_x11: capabilities.backend === "x11",
        capture_reports_no_display_server: capabilities.capture.reason === "no_display_server",
        window_capture_reports_no_display_server: capabilities.windowCapture.reason === "no_display_server",
        capture_refused_unavailable_no_display_server: unavailable(capture),
        displays_refused_unavailable_no_display_server: unavailable(displays),
        zoom_refused_unavailable_no_display_server: unavailable(zoom),
        next_call_is_diagnose:
          capture !== undefined &&
          JSON.stringify(capture.data).includes("computer.diagnose") &&
          JSON.stringify(capture.data).includes("hand"),
      },
      facts: {
        capabilities,
        refusals: {
          capture: capture?.code ?? null,
          displays: displays?.code ?? null,
          zoom: zoom?.code ?? null,
          reason: capture?.data.reason ?? null,
        },
        input_sent: 0,
      },
      observer: { before: {}, after: { backend: capabilities.backend } },
    }
  },
}
