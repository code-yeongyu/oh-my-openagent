import type { Signal } from "../summary.ts"
import type { ControlLine } from "./helper.ts"
import type { HelperPaths, MacSession } from "./session.ts"

type Plant = Signal | "warp" | "sheet"
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
    case "sheet":
      return "sheet"
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
async function openApp(path: string): Promise<void> {
  const child = Bun.spawn(["/usr/bin/open", "-a", path], { stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`open -a ${path} failed: ${stderr.trim()}`)
}

// Activation goes through LaunchServices (`open -a`), as a person's click would. On macOS 14+ the frontmost typist
// first yields to the idle app; the idle app reports when it actually became active, then yields back, and the typist
// is brought to the front again the same way and confirmed frontmost.
async function activation(session: MacSession, helpers: HelperPaths): Promise<PlantOutcome> {
  const { typist, idle } = session
  if (typist === undefined || idle === undefined) return { failed: "session has no typist or idle app" }
  const armed = idle.next((line) => line.ctl === "armed", RESTORE_MS, "idle app armed")
  idle.send(`arm ${session.typistPid}`)
  await armed
  await session.nextEvent((event) => event.kind === "typed", 2_500, "a keystroke to plant after")
  const yielded = typist.next((line) => line.ctl === "yielded", RESTORE_MS, "typist yield")
  typist.send(`yield ${session.idlePid}`)
  await yielded
  const ours = (line: ControlLine): boolean => line.plant === "activation"
  const planted = idle.next((line) => ours(line) && line.ctl === "planted", RESTORE_MS, "the idle app becoming active")
  const restoring = idle.next(
    (line) => ours(line) && line.ctl === "restoring",
    PLANT_MS + RESTORE_MS,
    "idle yield back",
  )
  restoring.catch(() => undefined)
  await openApp(helpers.idleApp)
  let line: ControlLine
  try {
    line = await planted
  } catch {
    return { failed: "the idle app did not become active after open -a" }
  }
  if (typeof line.t !== "number") return { failed: `planted line without t: ${JSON.stringify(line)}` }
  await restoring
  await openApp(helpers.typistApp)
  const back = typist.next((reply) => reply.ctl === "activated", RESTORE_MS, "typist back in front")
  typist.send("activate")
  const reply = await back
  if (reply.frontmost !== true || reply.key !== true)
    throw new Error(
      `the typist did not take the front and key focus back after the activation plant: ${JSON.stringify(reply)}`,
    )
  return { plantedAt: line.t }
}

export async function plant(session: MacSession, helpers: HelperPaths, which: Plant): Promise<PlantOutcome> {
  if (which === "activation") return activation(session, helpers)
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
