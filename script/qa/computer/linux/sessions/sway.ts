// The `sway` session: a headless sway (the wlroots headless backend with the pixman renderer,
// no libinput devices, no Xwayland) on this run's own runtime directory - the container-safe
// stand-in for a wlroots desktop. The driver never connects to a display it did not start:
// the host's DISPLAY, WAYLAND_DISPLAY and SWAYSOCK are cleared for sway and never reach the
// engine. wlroots serves no EIS socket, so LIBEI_SOCKET names where a scenario's fake EIS
// listens (scenarios/fake-eis.ts), and the engine runs the Wayland backend.
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { until, type Processes } from "../lib/procs.ts"
import { privateDirs } from "../lib/runtime-dirs.ts"
import { missingTools } from "../lib/session-checks.ts"
import { resolveTool } from "../lib/tools.ts"
import type { Stage } from "../lib/scenario.ts"

const OUTPUT = "HEADLESS-1"
const CONFIG = [`output ${OUTPUT} resolution 1280x800 position 0 0`, "xwayland disable", ""].join("\n")
const HOST_DISPLAYS = { DISPLAY: undefined, WAYLAND_DISPLAY: undefined, SWAYSOCK: undefined }

export async function start(procs: Processes, runDir: string): Promise<Stage> {
  const tools = ["sway", "swaymsg"]
  const found = new Map(tools.map((tool) => [tool, resolveTool(tool)]))
  const missing = missingTools(tools, (tool) => found.get(tool) !== null)
  if (missing.length > 0) throw new Error(`this host lacks ${missing.join(", ")}`)
  const bin = (tool: string): string => found.get(tool) ?? tool
  const dirs = privateDirs(runDir)
  const config = join(runDir, "sway.config")
  writeFileSync(config, CONFIG)
  procs.start("sway", [bin("sway"), "--config", config], {
    ...HOST_DISPLAYS,
    ...dirs,
    WLR_BACKENDS: "headless",
    WLR_LIBINPUT_NO_DEVICES: "1",
    WLR_RENDERER: "pixman",
  })
  let ipc = ""
  let display = ""
  await until(() => {
    const names = readdirSync(dirs.XDG_RUNTIME_DIR)
    ipc = names.find((name) => name.startsWith("sway-ipc.") && name.endsWith(".sock")) ?? ""
    display = names.find((name) => /^wayland-\d+$/.test(name)) ?? ""
    return ipc !== "" && display !== ""
  }, "sway to open its IPC and Wayland sockets")
  const env: Record<string, string | undefined> = {
    ...HOST_DISPLAYS,
    ...dirs,
    WAYLAND_DISPLAY: display,
    SWAYSOCK: join(dirs.XDG_RUNTIME_DIR, ipc),
    LIBEI_SOCKET: join(dirs.XDG_RUNTIME_DIR, "eis", "eis-fake"),
    OMO_COMPUTER_BACKEND: "wayland",
  }
  await until(
    () =>
      procs
        .run([bin("swaymsg"), "-t", "get_outputs", "-r"], env)
        .then((ran) => ran.code === 0 && ran.stdout.includes(`"${OUTPUT}"`)),
    `sway to answer get_outputs with ${OUTPUT}`,
  )
  return { session: "sway", display, env, runDir }
}
