import { spawn } from "node:child_process"

import type { BackgroundEnable } from "./remote-bootstrap"

/**
 * `omo remote enable` in its own detached process with no pipes back to this one (omo#13722), so the login that
 * starts it exits at once while the install runs to its end. An npm launcher (`.js`) runs under this runtime, a
 * compiled omo directly; the child inherits the environment, including the API the login signed in to.
 */
export function backgroundEnable(
  omoBin: string,
  options: {
    readonly execPath?: string
    readonly spawn?: typeof spawn
    readonly log?: (line: string) => void
  } = {},
): BackgroundEnable {
  return () => {
    const execPath = options.execPath ?? process.execPath
    const [command, args] = omoBin.endsWith(".js")
      ? [execPath, [omoBin, "remote", "enable"]]
      : [omoBin, ["remote", "enable"]]
    const child = (options.spawn ?? spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    })
    child.once("error", (error: Error) =>
      (options.log ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `Remote could not be turned on in the background (${error.message}). Run: omo remote enable`,
      ),
    )
    child.unref()
  }
}
