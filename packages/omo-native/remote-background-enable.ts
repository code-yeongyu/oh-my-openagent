import { spawn } from "node:child_process"
import { basename } from "node:path"

import { findOnPath } from "../omo-senpi/src/components/claude-code/find-on-path"
import type { BackgroundRemote } from "./remote-bootstrap"
import { AFTER_LOGIN_FLAG } from "./remote-verbs"

/** The part of node's spawn this needs; a test passes a recorder. */
export type DetachedSpawn = (
  command: string,
  args: readonly string[],
  options: { detached: true; stdio: "ignore"; windowsHide: true; env: NodeJS.ProcessEnv },
) => { once(event: "error", listener: (error: Error) => void): unknown; unref(): void }

const JS_RUNTIMES = ["bun", "node"]

/**
 * The runtime an npm launcher (`.js`) runs under. This process when it is bun or node. A compiled omo is neither, and
 * it still gets a `.js` target when it inherits the npm launcher's OMO_BIN (#13724 review L2): then the runtime that
 * launcher chose (SENPI_RUNTIME), else bun, else node, from PATH, where the launcher put its own node bin first.
 */
function jsRuntime(execPath: string, env: NodeJS.ProcessEnv): string | null {
  if (
    JS_RUNTIMES.includes(
      basename(execPath)
        .toLowerCase()
        .replace(/\.exe$/, ""),
    )
  )
    return execPath
  const chosen = env.SENPI_RUNTIME
  const order = chosen !== undefined && JS_RUNTIMES.includes(chosen) ? [chosen, ...JS_RUNTIMES] : JS_RUNTIMES
  for (const name of order) {
    const found = findOnPath(name, env)
    if (found !== null) return found
  }
  return null
}

/**
 * `omo remote <verb>` in its own detached process with no pipes back to this one (omo#13722), so the login that
 * starts it exits at once while the install runs to its end. An npm launcher (`.js`) runs under a JS runtime, a
 * compiled omo directly; the child inherits the environment, including the API the login signed in to.
 */
export function backgroundRemote(
  omoBin: string,
  options: {
    readonly execPath?: string
    readonly env?: NodeJS.ProcessEnv
    readonly spawn?: DetachedSpawn
    readonly log?: (line: string) => void
  } = {},
): BackgroundRemote {
  return (verb) => {
    const env = options.env ?? process.env
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
    const notStarted = (reason: string) =>
      log(`omo remote ${verb} could not start in the background (${reason}). Run: omo remote ${verb}`)
    // The enable login starts says so, so it keeps an opt-out recorded while it installs (#13724 review M1).
    const remoteArgs = verb === "enable" ? ["remote", verb, AFTER_LOGIN_FLAG] : ["remote", verb]
    let command = omoBin
    let args = remoteArgs
    if (omoBin.endsWith(".js")) {
      const runtime = jsRuntime(options.execPath ?? process.execPath, env)
      if (runtime === null) return notStarted("no bun or node on PATH")
      command = runtime
      args = [omoBin, ...remoteArgs]
    }
    const child = (options.spawn ?? spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env,
    })
    child.once("error", (error: Error) => notStarted(error.message))
    child.unref()
  }
}
