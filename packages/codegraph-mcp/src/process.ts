import { spawn } from "node:child_process"
import { extname } from "node:path"

import type {
  CodegraphCommandResult,
  CodegraphCommandRunner,
  CodegraphServerSpawner,
} from "./types.js"

const COMMAND_TIMEOUT_MS = 60_000
const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"])
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"])

export interface ProcessInvocation {
  readonly args: readonly string[]
  readonly command: string
}

export function resolveCodegraphProcessInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ProcessInvocation {
  if (platform !== "win32") return { args: [...args], command }

  const extension = extname(command).toLowerCase()
  if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { args: [command, ...args], command: process.execPath }
  }
  if (WINDOWS_CMD_EXTENSIONS.has(extension)) {
    return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" }
  }
  return { args: [...args], command }
}

export const runCodegraphCommand: CodegraphCommandRunner = async (cwd, spec, args, env) => {
  const invocation = resolveCodegraphProcessInvocation(spec.command, [...spec.argsPrefix, ...args])
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

  return new Promise<CodegraphCommandResult>((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, COMMAND_TIMEOUT_MS)
    timer.unref()
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? (signal === null ? 0 : 1),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
        timedOut,
      })
    })
  })
}

export const spawnCodegraphServer: CodegraphServerSpawner = (cwd, spec, env) => {
  const invocation = resolveCodegraphProcessInvocation(spec.command, [...spec.argsPrefix, "serve", "--mcp"])
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve(code ?? (signal === null ? 0 : 1)))
  })
  return {
    input: child.stdin,
    output: child.stdout,
    error: child.stderr,
    wait: () => exit,
    terminate: () => child.kill("SIGTERM"),
  }
}
