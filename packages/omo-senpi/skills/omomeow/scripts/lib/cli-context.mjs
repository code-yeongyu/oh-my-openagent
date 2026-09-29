import { join } from "node:path"

import { resolveStateDir } from "./files.mjs"

/** A wrong invocation: the CLI prints the message and exits 2. */
export class UsageError extends Error {}

export function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

/** Paths every command shares, resolved once from the environment. */
export function createContext(env = process.env) {
  const stateDir = resolveStateDir(env)
  return {
    env,
    cwd: process.cwd(),
    stateDir,
    statePath: join(stateDir, "state.json"),
    sessionsPath: join(stateDir, "sessions.json"),
    nudgeStatePath: join(stateDir, "nudge.json"),
  }
}
