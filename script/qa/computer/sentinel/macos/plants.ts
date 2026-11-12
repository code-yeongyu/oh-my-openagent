import type { Signal } from "../summary.ts"
import type { ControlLine } from "./helper.ts"
import type { MacSession } from "./session.ts"

type Plant = Signal | "warp"
type PlantOutcome = { readonly plantedAt: number } | { readonly failed: string }

const PLANT_MS = 4_000
const RESTORE_MS = 3_000

function command(session: MacSession, plant: Exclude<Plant, "activation">): string {
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
    case "typing":
      return "drop-next"
  }
}

// Plants one disturbance right after a keystroke and waits until it is restored, so the next keystroke lands on a
// desktop that looks untouched. The dropped keystroke is planted by the typist itself at its next keystroke.
// macOS 14+ activation is cooperative: the frontmost typist yields to the idle app, the idle app activates and
// yields back, and the typist takes the front again; each hop is confirmed before the next.
async function activation(session: MacSession): Promise<PlantOutcome> {
  const { typist, idle } = session
  if (typist === undefined || idle === undefined) return { failed: "session has no typist or idle app" }
  await session.nextEvent((event) => event.kind === "typed", 2_500, "a keystroke to plant after")
  const yielded = typist.next((line) => line.ctl === "yielded", RESTORE_MS, "typist yield")
  typist.send(`yield ${session.idlePid}`)
  await yielded
  const ours = (line: ControlLine): boolean => line.plant === "activation"
  const outcome = idle.next(
    (line) => ours(line) && (line.ctl === "planted" || line.ctl === "plant_failed"),
    PLANT_MS,
    "activation plant",
  )
  const restoring = idle.next(
    (line) => ours(line) && line.ctl === "restoring",
    PLANT_MS + RESTORE_MS,
    "idle yield back",
  )
  restoring.catch(() => undefined)
  idle.send(`activate ${session.typistPid}`)
  const line = await outcome
  if (line.ctl === "plant_failed") return { failed: String(line.detail) }
  if (typeof line.t !== "number") return { failed: `planted line without t: ${JSON.stringify(line)}` }
  await restoring
  const back = typist.next((reply) => reply.ctl === "activated", RESTORE_MS, "typist back in front")
  typist.send("activate")
  const reply = await back
  if (reply.frontmost !== true) throw new Error("the typist could not take the front back after the activation plant")
  return { plantedAt: line.t }
}

export async function plant(session: MacSession, which: Plant): Promise<PlantOutcome> {
  if (which === "activation") return activation(session)
  const helper = which === "typing" ? session.typist : session.planter
  if (helper === undefined) return { failed: "session has no planter" }
  const ours = (line: ControlLine): boolean => line.plant === which
  const outcome = helper.next(
    (line) => ours(line) && (line.ctl === "planted" || line.ctl === "plant_failed"),
    PLANT_MS,
    `${which} plant`,
  )
  const restored = helper.next(
    (line) => ours(line) && line.ctl === "restored",
    PLANT_MS + RESTORE_MS,
    `${which} restore`,
  )
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
