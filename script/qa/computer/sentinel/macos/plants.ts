import type { Signal } from "../summary.ts"
import type { ControlLine } from "./helper.ts"
import type { MacSession } from "./session.ts"

type Plant = Signal | "warp"
type PlantOutcome = { readonly plantedAt: number } | { readonly failed: string }

const PLANT_MS = 4_000
const RESTORE_MS = 3_000

function command(session: MacSession, plant: Plant): string {
  switch (plant) {
    case "key_focus":
      return `focus ${session.typistPid}`
    case "window_raised":
      return `raise ${session.typistWindow}`
    case "pointer":
      return "pointer"
    case "warp":
      return "warp"
    case "clipboard":
      return "pasteboard"
    case "space":
      return "space"
    case "dialog":
      return "alert"
    case "activation":
      return `activate ${session.idlePid} ${session.typistPid}`
    case "typing":
      return "drop-next"
  }
}

// Plants one disturbance right after a keystroke and waits until it is restored, so the next keystroke lands on a
// desktop that looks untouched. The dropped keystroke is planted by the typist itself at its next keystroke.
export async function plant(session: MacSession, which: Plant): Promise<PlantOutcome> {
  const helper = which === "typing" ? session.typist : session.planter
  if (helper === undefined) return { failed: "session has no planter" }
  const ours = (line: ControlLine): boolean => line.plant === which
  const outcome = helper.next((line) => ours(line) && (line.ctl === "planted" || line.ctl === "plant_failed"), PLANT_MS, `${which} plant`)
  const restored = helper.next((line) => ours(line) && line.ctl === "restored", PLANT_MS + RESTORE_MS, `${which} restore`)
  restored.catch(() => undefined)
  if (which !== "typing")
    await session.nextEvent((event) => event.kind === "typed", 2_500, "a keystroke to plant after")
  helper.send(command(session, which))
  const line = await outcome
  if (line.ctl === "plant_failed") return { failed: String(line.detail) }
  if (typeof line.t !== "number") return { failed: `planted line without t: ${JSON.stringify(line)}` }
  if (which !== "typing") await restored
  return { plantedAt: line.t }
}
