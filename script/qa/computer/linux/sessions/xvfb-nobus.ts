// The `xvfb-nobus` session: the `xvfb` session without the accessibility bus, so a scenario
// can prove what a Linux box with no AT-SPI answers.
import type { Processes } from "../lib/procs.ts"
import type { Stage } from "../lib/scenario.ts"
import { startXvfb } from "./xvfb.ts"

export const SESSION = "xvfb-nobus" as const

export function start(procs: Processes, runDir: string): Promise<Stage> {
  return startXvfb(procs, runDir, true)
}
