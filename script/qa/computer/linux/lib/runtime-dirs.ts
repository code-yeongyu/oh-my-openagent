// Every session gets its own runtime and state directories (mode 0700) under the run
// directory and hands them to everything it starts, the engine included, through the XDG
// variables the engine already resolves its roots from. Nothing then depends on the host or
// container having /run/user/<uid>, and no run writes the real user's state directory.
import { mkdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"

export interface PrivateDirs {
  readonly XDG_RUNTIME_DIR: string
  readonly XDG_STATE_HOME: string
}

export function privateDirs(runDir: string): PrivateDirs {
  const root = mkdtempSync(join(runDir, "session-"))
  const runtime = join(root, "runtime")
  const state = join(root, "state")
  mkdirSync(runtime, { mode: 0o700 })
  mkdirSync(state, { mode: 0o700 })
  return { XDG_RUNTIME_DIR: runtime, XDG_STATE_HOME: state }
}
