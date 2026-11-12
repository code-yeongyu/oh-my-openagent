// The `xorg` session: a real Xorg run directly on the host with the dummy video driver -
// the one X11 session that sees kernel input devices. It refuses to start inside a
// container; the physical-key legs that need it run on a host whose /dev/uinput the job
// was granted (see the plan's H5 leg).
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { until, type Processes } from "../lib/procs.ts"
import type { Stage } from "../lib/scenario.ts"

const DISPLAY = ":64"

const CONF = `Section "Device"
    Identifier "dummy"
    Driver "dummy"
    VideoRam 256000
EndSection
Section "Screen"
    Identifier "screen"
    Device "dummy"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1280x800"
    EndSubSection
EndSection
Section "ServerLayout"
    Identifier "layout"
    Screen "screen"
EndSection
`

export const SESSION = "xorg" as const

export async function start(procs: Processes, runDir: string): Promise<Stage> {
  if (existsSync("/.dockerenv")) {
    throw new Error("the xorg session runs directly on the host, never inside a container")
  }
  const conf = join(runDir, "xorg.conf")
  writeFileSync(conf, CONF)
  procs.start("Xorg", ["Xorg", DISPLAY, "-config", conf, "-noreset", "-logfile", join(runDir, "Xorg.log")])
  const env = { DISPLAY }
  await until(
    () => procs.run(["xdpyinfo", "-display", DISPLAY], env).then((ran) => ran.code === 0),
    "Xorg to answer xdpyinfo",
  )
  return { session: "xorg", display: DISPLAY, env, runDir }
}
