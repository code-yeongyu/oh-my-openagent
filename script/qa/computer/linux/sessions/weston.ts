// The `weston` session: weston's headless backend on this run's own runtime directory and a
// fixed socket name. weston names no compositor env signature, carries no SP-W ledger row and
// serves no EIS socket: it is the negative control (release unproven, no window input). The
// host's DISPLAY and WAYLAND_DISPLAY are cleared for weston and never reach the engine;
// LIBEI_SOCKET names where a scenario's fake EIS listens (scenarios/fake-eis.ts).
import { existsSync } from "node:fs"
import { join } from "node:path"
import { until, type Processes } from "../lib/procs.ts"
import { privateDirs } from "../lib/runtime-dirs.ts"
import { resolveTool } from "../lib/tools.ts"
import type { Stage } from "../lib/scenario.ts"

const SOCKET = "wayland-omo-qa"
// The `<name>-backend.so` form: weston 10 (the QA image) reads only it, weston 12+ still accepts it.
const BACKEND = "headless-backend.so"
const HOST_DISPLAYS = { DISPLAY: undefined, WAYLAND_DISPLAY: undefined, SWAYSOCK: undefined }

export async function start(procs: Processes, runDir: string): Promise<Stage> {
  const weston = resolveTool("weston")
  if (weston === null) throw new Error("this host lacks weston")
  const dirs = privateDirs(runDir)
  const child = procs.start(
    "weston",
    [
      weston,
      `--backend=${BACKEND}`,
      `--socket=${SOCKET}`,
      "--width=1280",
      "--height=800",
      "--idle-time=0",
      "--no-config",
    ],
    { ...HOST_DISPLAYS, ...dirs },
  )
  const socket = join(dirs.XDG_RUNTIME_DIR, SOCKET)
  await until(() => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`weston exited: ${procs.output(child).trim().slice(-400)}`)
    return existsSync(socket) && procs.output(child).includes(BACKEND)
  }, "weston to load its headless backend and open its socket")
  const env: Record<string, string | undefined> = {
    ...HOST_DISPLAYS,
    ...dirs,
    WAYLAND_DISPLAY: SOCKET,
    LIBEI_SOCKET: join(dirs.XDG_RUNTIME_DIR, "eis", "eis-fake"),
    OMO_COMPUTER_BACKEND: "wayland",
  }
  return { session: "weston", display: SOCKET, env, runDir }
}
