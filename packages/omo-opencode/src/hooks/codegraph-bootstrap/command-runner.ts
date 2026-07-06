import { extname } from "node:path"
import { execPath as processExecPath } from "node:process"
import { buildCodegraphChildEnv } from "@oh-my-opencode/utils"

export interface CodegraphCommandResult {
  readonly exitCode: number
  readonly stderr?: string
  readonly stdout: string
  readonly timedOut: boolean
}

export interface RunCodegraphCommandOptions {
  readonly env: Record<string, string>
  readonly timeoutMs: number
}

export interface CodegraphCommandInvocation {
  readonly args: readonly string[]
  readonly command: string
}

const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"])
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"])

function toOutputText(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value
}

function resolveExitCode(error: Error): number {
  if ("code" in error) {
    const code = error.code
    if (typeof code === "number") return code
  }
  return 1
}

export async function runCodegraphCommand(
  projectRoot: string,
  command: string,
  args: readonly string[],
  options: RunCodegraphCommandOptions,
): Promise<CodegraphCommandResult> {
  const { execFile } = await import("node:child_process")
  const invocation = resolveCodegraphCommandInvocation(command, args)

  return new Promise((resolve) => {
    execFile(
      invocation.command,
      [...invocation.args],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: buildCodegraphChildEnv({ ambientEnv: process.env, codegraphEnv: options.env }),
        maxBuffer: 1024 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false })
          return
        }

        resolve({
          exitCode: resolveExitCode(error),
          stderr: toOutputText(stderr),
          stdout: toOutputText(stdout),
          timedOut: error.killed === true,
        })
      },
    )
  })
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
