// The `none` session: no display server at all, the shape a headless box reports.
import type { Processes } from "../lib/procs.ts"
import { privateDirs } from "../lib/runtime-dirs.ts"
import type { Stage } from "../lib/scenario.ts"

export async function start(procs: Processes, runDir: string): Promise<Stage> {
  void procs
  return {
    session: "none",
    display: undefined,
    env: { DISPLAY: undefined, ...privateDirs(runDir) },
    runDir,
  }
}
