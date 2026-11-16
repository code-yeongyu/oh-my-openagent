// A-IS-62 release-gate item 5 (R70aw(5)), the live negative cases on X11: with no consent file
// the engine read itself, a real backend's session admits no exec and arms no chord. Every fact
// is read twice: the engine's answers, and the pointer position from xdotool (the oracle).
import type { EngineError, JsonObject } from "./engine.ts"
import type { Checked, Context } from "./scenario.ts"

function deaf(error: EngineError | undefined): boolean {
  return error !== undefined && error.code === "StopPathUnavailable" && error.data.reason === "deaf"
}

async function pointer(ctx: Context): Promise<string> {
  return (await ctx.procs.stdout(["xdotool", "getmouselocation", "--shell"], ctx.stage.env)).trim()
}

/** Opens a session, starts the stop path (carrying `chord` when given) and tries one click. */
export async function noConsentFile(ctx: Context, chord: string | undefined): Promise<Checked> {
  const { engine } = ctx
  await engine.open("os")
  const start = await engine.refusal("stopPath.start", chord === undefined ? {} : { chord })
  const capabilities = (await engine.call("capabilities")) as { stopPath?: JsonObject }
  const stopPath = capabilities.stopPath ?? {}
  const before = await pointer(ctx)
  const click = await engine.refusal("click", { target: "desktop", x: 300, y: 200 })
  const after = await pointer(ctx)
  return {
    checks: {
      stop_path_start_refused_deaf: deaf(start),
      capabilities_read_deaf: stopPath.deaf === true,
      deaf_reason_is_chord_unarmable: stopPath.deafReason === "chord-unarmable",
      click_refused_stop_path_deaf: deaf(click),
      pointer_unmoved_for_the_oracle: before === after,
    },
    facts: {
      carried_chord: chord ?? null,
      stop_path_start: start === undefined ? { answered: true } : { code: start.code, data: start.data },
      stop_path: stopPath,
      click: click === undefined ? { answered: true } : { code: click.code, data: click.data },
      input_sent: 0,
    },
    observer: { before: { pointer: before }, after: { pointer: after } },
  }
}
