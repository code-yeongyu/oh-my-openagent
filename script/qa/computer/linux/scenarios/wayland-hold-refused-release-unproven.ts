// Row 51 on headless weston, the compositor with no SP-W release-on-close row: the hand reads
// `releaseHelper` unavailable (`wayland_release_unproven`) and refuses `key.down` and
// `mouse.down` with `StopPathUnavailable{release_helper_unavailable}` before any libei frame,
// while a non-hold verb is not refused by that gate (fixture
// crates/omo-computer-backend-wayland/fixtures/wayland-hold-refused-release-unproven.json). The
// engine is connected to the fake EIS first, so "no frame" is read from a live client; the
// fake's own log is the oracle.
import type { EngineError } from "../lib/engine.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"
import { compileKeymap, count, startFakeEis } from "./fake-eis.ts"

const RELEASE_GATE = "release_helper_unavailable"

function refusedByTheReleaseGate(error: EngineError | undefined): boolean {
  return error !== undefined && error.code === "StopPathUnavailable" && error.data.reason === RELEASE_GATE
}

function refusal(error: EngineError | undefined): { code: string; reason: string | null } | null {
  if (error === undefined) return null
  const reason = error.data.reason
  return { code: error.code, reason: typeof reason === "string" ? reason : null }
}

export const waylandHoldRefusedReleaseUnproven: Scenario = {
  name: "wayland-hold-refused-release-unproven",
  admit: "none",
  sessions: ["weston"],
  requires: ["xkbcli"],
  async run(ctx: Context): Promise<Checked> {
    const { engine } = ctx
    const keymap = await compileKeymap(ctx, "us")
    const eis = await startFakeEis(ctx, keymap, "serve", ["0,0,1280,800"])
    try {
      await engine.open("none")
      const capabilities = (await engine.call("capabilities")) as {
        releaseHelper?: { available?: boolean; reason?: string }
        compositor?: { name?: string }
      }
      const diagnosis = (await engine.call("diagnose")) as { checks?: { name: string; state: string }[] }
      const before = eis.read()
      const keyDown = await engine.refusal("key.down", { target: "screen", chord: "shift" })
      const mouseDown = await engine.refusal("mouse.down", { target: "screen", x: 10, y: 10 })
      const press = await engine.refusal("press", { chord: "a" })
      const after = eis.read()
      const held = after.held
      return {
        checks: {
          release_helper_reads_unproven:
            capabilities.releaseHelper?.available === false &&
            capabilities.releaseHelper.reason === "wayland_release_unproven",
          libei_client_is_live_before_the_holds:
            diagnosis.checks?.find((check) => check.name === "libei")?.state === "ok" &&
            count(before, "connections") === 1,
          key_down_refused_by_the_release_gate: refusedByTheReleaseGate(keyDown),
          mouse_down_refused_by_the_release_gate: refusedByTheReleaseGate(mouseDown),
          holds_sent_no_libei_frame:
            count(after, "frames") === count(before, "frames") &&
            count(after, "keys") === 0 &&
            count(after, "buttons") === 0 &&
            count(after, "motions") === 0,
          nothing_is_held: Array.isArray(held) && held.length === 0,
          press_is_not_refused_by_the_release_gate: !refusedByTheReleaseGate(press),
        },
        facts: {
          compositor: capabilities.compositor?.name ?? null,
          key_down: refusal(keyDown),
          mouse_down: refusal(mouseDown),
          press: refusal(press),
          input_sent: 0,
        },
        observer: { before, after },
      }
    } finally {
      await eis.stop()
    }
  },
}
