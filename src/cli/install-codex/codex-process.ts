import { spawn } from "../../shared/bun-spawn-shim"
import type { RunCommand } from "./types"

export const defaultRunCommand: RunCommand = async (command, args, options) => {
  const proc = spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })

  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${options.cwd} with exit code ${code}`)
  }
}
