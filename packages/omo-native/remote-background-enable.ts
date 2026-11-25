import { spawn } from "node:child_process"

import type { BackgroundRemote } from "./remote-bootstrap"
import { AFTER_LOGIN_FLAG } from "./remote-verbs"

/** The part of node's spawn this needs; a test passes a recorder. */
export type DetachedSpawn = (
  command: string,
  args: readonly string[],
  options: { detached: true; stdio: "ignore"; windowsHide: true; env: NodeJS.ProcessEnv },
) => { once(event: "error", listener: (error: Error) => void): unknown; unref(): void }

/**
 * `omo remote <verb>` in its own detached process with no pipes back to this one (omo#13722), so the login that
 * starts it exits at once while the install runs to its end. An npm launcher (`.js`) runs under this runtime, a
 * compiled omo directly; the child inherits the environment, including the API the login signed in to.
 */
export function backgroundRemote(
  omoBin: string,
  options: {
    readonly execPath?: string
    readonly spawn?: DetachedSpawn
    readonly log?: (line: string) => void
  } = {},
): BackgroundRemote {
  return (verb) => {
    const execPath = options.execPath ?? process.execPath
    // The enable login starts says so, so it keeps an opt-out recorded while it installs (#13724 review M1).
    const remoteArgs = verb === "enable" ? ["remote", verb, AFTER_LOGIN_FLAG] : ["remote", verb]
    const [command, args] = omoBin.endsWith(".js") ? [execPath, [omoBin, ...remoteArgs]] : [omoBin, remoteArgs]
    const child = (options.spawn ?? spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    })
    child.once("error", (error: Error) =>
      (options.log ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `omo remote ${verb} could not start in the background (${error.message}). Run: omo remote ${verb}`,
      ),
    )
    child.unref()
  }
}
