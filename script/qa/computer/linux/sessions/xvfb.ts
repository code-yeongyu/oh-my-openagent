// The `xvfb` session: Xvfb with xfwm4 and xcompmgr, on a private D-Bus with the AT-SPI
// registry when the bus is asked for - the container-safe stand-in for a real X desktop.
// The driver never connects to a display it did not start: every server lives on the fixed
// display below, inside this run's own processes.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { until, type Processes } from "../lib/procs.ts"
import { compositorOwnerArgv, ownsCompositorSelection } from "../lib/compositor.ts"
import { privateDirs } from "../lib/runtime-dirs.ts"
import { missingTools, wmOwnsRoot } from "../lib/session-checks.ts"
import { resolveTool } from "../lib/tools.ts"
import type { Stage } from "../lib/scenario.ts"

const DISPLAY = ":137"
const SCREEN = "1280x800x24"

export async function startXvfb(procs: Processes, runDir: string, nobus: boolean): Promise<Stage> {
  const tools = [
    "Xvfb",
    "xdpyinfo",
    "xprop",
    "xfwm4",
    "xcompmgr",
    "python3",
    ...(nobus ? [] : ["dbus-daemon", "dbus-send", "at-spi-bus-launcher"]),
  ]
  const found = new Map(tools.map((tool) => [tool, resolveTool(tool)]))
  const missing = missingTools(tools, (tool) => found.get(tool) !== null)
  if (missing.length > 0) throw new Error(`this host lacks ${missing.join(", ")}`)
  const bin = (tool: string): string => found.get(tool) ?? tool
  const env: Record<string, string | undefined> = { DISPLAY, ...privateDirs(runDir) }
  if (!nobus) {
    const busDir = join(runDir, "bus")
    mkdirSync(busDir, { recursive: true })
    const address = `unix:path=${join(busDir, "session")}`
    procs.start("dbus-daemon", [bin("dbus-daemon"), "--session", "--address=" + address, "--fork", "--print-address=1"])
    env.DBUS_SESSION_BUS_ADDRESS = address
    await until(
      () =>
        procs
          .run(
            [
              bin("dbus-send"),
              "--session",
              "--dest=org.freedesktop.DBus",
              "--print-reply",
              "/org/freedesktop/DBus",
              "org.freedesktop.DBus.ListNames",
            ],
            env,
          )
          .then((ran) => ran.code === 0),
      "the private bus to answer",
    )
    procs.start("at-spi", [bin("at-spi-bus-launcher"), "--launch-immediately"], env)
  }
  procs.start("Xvfb", [bin("Xvfb"), DISPLAY, "-screen", "0", SCREEN, "-nolisten", "tcp"], env)
  await until(
    () => procs.run([bin("xdpyinfo"), "-display", DISPLAY], env).then((ran) => ran.code === 0),
    "Xvfb to answer xdpyinfo",
  )
  procs.start("xfwm4", [bin("xfwm4"), "--display", DISPLAY], env)
  await until(
    () =>
      procs
        .run([bin("xprop"), "-root", "_NET_SUPPORTING_WM_CHECK"], env)
        .then((ran) => ran.code === 0 && wmOwnsRoot(ran.stdout)),
    "xfwm4 to own the root window",
  )
  procs.start("xcompmgr", [bin("xcompmgr"), "-d", DISPLAY], env)
  await until(
    () =>
      procs
        .run(compositorOwnerArgv(bin("python3")), env)
        .then((ran) => ran.code === 0 && ownsCompositorSelection(ran.stdout)),
    "xcompmgr to own _NET_WM_CM_S0",
  )
  return { session: nobus ? "xvfb-nobus" : "xvfb", display: DISPLAY, env, runDir }
}

export function start(procs: Processes, runDir: string): Promise<Stage> {
  return startXvfb(procs, runDir, false)
}
