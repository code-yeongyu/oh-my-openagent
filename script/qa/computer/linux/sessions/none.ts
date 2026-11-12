// The `none` session: no display server at all, the shape a headless box reports.
import type { Processes } from "../lib/procs.ts"
import type { Stage } from "../lib/scenario.ts"

export const SESSION = "none" as const

export async function start(procs: Processes, runDir: string): Promise<Stage> {
  void procs
  return {
    session: "none",
    display: undefined,
    env: { DISPLAY: undefined },
    runDir,
  }
}
