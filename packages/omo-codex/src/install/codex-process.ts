import { spawn } from "../../../omo-opencode/src/shared/bun-spawn-shim"
import type { RunCommand } from "./types"

const WINDOWS_CMD_SHIM_COMMANDS = new Set(["codex", "npm", "npx"])

export type RunCommandInvocation = {
  readonly command: string
  readonly args: readonly string[]
}

export function resolveRunCommandInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): RunCommandInvocation {
  if (platform !== "win32" || !WINDOWS_CMD_SHIM_COMMANDS.has(command.toLowerCase())) {
    return { command, args: [...args] }
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `${command}.cmd`, ...args],
  }
}

export const defaultRunCommand: RunCommand = async (command, args, options) => {
  const invocation = resolveRunCommandInvocation(command, args)
  const proc = spawn({
    cmd: [invocation.command, ...invocation.args],
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })

  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${options.cwd} with exit code ${code}`)
  }
}
