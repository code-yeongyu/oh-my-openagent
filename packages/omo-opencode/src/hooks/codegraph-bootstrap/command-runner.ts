import { extname } from "node:path"
import { execPath as processExecPath } from "node:process"
import { buildCodegraphChildEnv } from "@oh-my-opencode/utils"
import { runProcessWithTreeTimeout } from "@oh-my-opencode/utils/process-tree"

export interface CodegraphCommandResult {
  readonly exitCode: number
  readonly stderr?: string
  readonly stdout: string
  readonly timedOut: boolean
}

export interface RunCodegraphCommandOptions {
  readonly env: Record<string, string>
  readonly timeoutSignal?: AbortSignal
  readonly timeoutMs: number
}

export interface CodegraphCommandInvocation {
  readonly args: readonly string[]
  readonly command: string
}

const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"])
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"])

export async function runCodegraphCommand(
  projectRoot: string,
  command: string,
  args: readonly string[],
  options: RunCodegraphCommandOptions,
): Promise<CodegraphCommandResult> {
  const invocation = resolveCodegraphCommandInvocation(command, args)

  return runProcessWithTreeTimeout({
    args: invocation.args,
    command: invocation.command,
    cwd: projectRoot,
    env: buildCodegraphChildEnv({ ambientEnv: process.env, codegraphEnv: options.env }),
    maxBuffer: 1024 * 1024,
    ...(options.timeoutSignal === undefined ? {} : { timeoutSignal: options.timeoutSignal }),
    timeoutMs: options.timeoutMs,
  }).then(({ exitCode, stderr, stdout, timedOut }) => ({ exitCode, stderr, stdout, timedOut }))
}

export function resolveCodegraphCommandInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): CodegraphCommandInvocation {
  if (platform !== "win32") return { args: [...args], command }
  const extension = extname(command).toLowerCase()
  if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) return { args: [command, ...args], command: processExecPath }
  if (!WINDOWS_CMD_EXTENSIONS.has(extension)) return { args: [...args], command }
  return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" }
}
