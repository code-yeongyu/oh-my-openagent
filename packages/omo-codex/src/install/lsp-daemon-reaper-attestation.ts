import { execFile } from "node:child_process"
import { readFile, readdir, readlink } from "node:fs/promises"
import { connect } from "node:net"
import { basename } from "node:path"

export interface LegacyDaemonAttestationInput {
  readonly pid: number
  readonly endpoint: string
  readonly platform: NodeJS.Platform
}

export interface LegacyDaemonAttestationDeps {
  readonly executeFile?: typeof execFile
  readonly readFile?: typeof readFile
  readonly readDir?: typeof readdir
  readonly readLink?: typeof readlink
}

const PROBE_TIMEOUT_MS = 500

export async function probeLegacyJsonRpcEndpoint(endpoint: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect(endpoint)
    let settled = false
    let buffer = ""
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(legacyStatusRequest())}\n`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newlineIndex = buffer.indexOf("\n")
      if (newlineIndex < 0) return
      finish(isJsonRpcResponse(buffer.slice(0, newlineIndex).trim()))
    })
    socket.once("error", () => finish(false))
  })
}

export async function attestLegacyDaemonOwnership(
  input: LegacyDaemonAttestationInput,
  deps: LegacyDaemonAttestationDeps = {},
): Promise<boolean> {
  if (input.platform === "linux") return await attestLinuxOwnership(input, deps)
  if (input.platform === "darwin") return await attestMacOwnership(input, deps)
  return false
}

async function attestLinuxOwnership(
  input: LegacyDaemonAttestationInput,
  deps: LegacyDaemonAttestationDeps,
): Promise<boolean> {
  const readFileImpl = deps.readFile ?? readFile
  const readDirImpl = deps.readDir ?? readdir
  const readLinkImpl = deps.readLink ?? readlink

  const procNetUnix = await readText(readFileImpl, "/proc/net/unix")
  if (procNetUnix === null) return false
  const inode = inodeForEndpoint(procNetUnix, input.endpoint)
  if (inode === null) return false

  const fdEntries = await readDirImpl(`/proc/${input.pid}/fd`).catch(() => null)
  if (fdEntries === null) return false
  let ownsEndpoint = false
  for (const fdEntry of fdEntries) {
    const target = await readLinkImpl(`/proc/${input.pid}/fd/${fdEntry}`).catch(() => null)
    if (target !== `socket:[${inode}]`) continue
    ownsEndpoint = true
    break
  }
  if (!ownsEndpoint) return false

  const cmdline = await readBinary(readFileImpl, `/proc/${input.pid}/cmdline`)
  if (cmdline === null) return false
  return isNodeCliDaemonArgv(splitCmdline(cmdline))
}

async function attestMacOwnership(
  input: LegacyDaemonAttestationInput,
  deps: LegacyDaemonAttestationDeps,
): Promise<boolean> {
  const executeFileImpl = deps.executeFile ?? execFile
  const filteredLsofOutput = await executeForStdout(executeFileImpl, "/usr/sbin/lsof", [
    "-a",
    "-n",
    "-P",
    "-p",
    String(input.pid),
    "-U",
    "-Fn",
    "--",
    input.endpoint,
  ])
  const lsofOutput = filteredLsofOutput ?? await executeForStdout(executeFileImpl, "/usr/sbin/lsof", [
    "-a",
    "-n",
    "-P",
    "-p",
    String(input.pid),
    "-U",
    "-Fn",
  ])
  if (lsofOutput === null || !lsofShowsUnixEndpoint(lsofOutput, input.pid, input.endpoint)) return false

  const commandOutput = await executeForStdout(executeFileImpl, "/bin/ps", ["-p", String(input.pid), "-o", "command="])
  if (commandOutput === null) return false
  return isNodeCliDaemonCommand(commandOutput.trim())
}

function legacyStatusRequest(): { readonly jsonrpc: "2.0"; readonly id: 1; readonly method: "tools/call"; readonly params: { readonly name: "status"; readonly arguments: Record<string, never> } } {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "status", arguments: {} },
  }
}

function isJsonRpcResponse(line: string): boolean {
  if (line.length === 0) return false
  try {
    const parsed = JSON.parse(line) as { readonly jsonrpc?: unknown; readonly id?: unknown; readonly result?: unknown; readonly error?: unknown }
    return parsed.jsonrpc === "2.0" && parsed.id === 1 && (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error"))
  } catch {
    return false
  }
}

function inodeForEndpoint(procNetUnix: string, endpoint: string): string | null {
  for (const line of procNetUnix.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("Num")) continue
    const fields = trimmed.split(/\s+/)
    if (fields.length < 8 || fields[7] !== endpoint) continue
    return fields[6] ?? null
  }
  return null
}

function splitCmdline(buffer: Buffer): readonly string[] {
  return buffer
    .toString("utf8")
    .split("\u0000")
    .filter((value) => value.length > 0)
}

function isNodeCliDaemonArgv(argv: readonly string[]): boolean {
  if (argv.length < 2 || !argv.includes("daemon")) return false
  const executable = basename(argv[0] ?? "")
  if (!/^node(?:\.exe)?$/i.test(executable)) return false
  return argv.some((value) => value === "cli.js" || value.endsWith("/cli.js") || value.endsWith("\\cli.js"))
}

function lsofShowsUnixEndpoint(output: string, pid: number, endpoint: string): boolean {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0)
  const endpointName = basename(endpoint)
  return lines.includes(`p${pid}`) && lines.some((line) => line === `n${endpoint}` || line === `n${endpointName}`)
}

function isNodeCliDaemonCommand(command: string): boolean {
  return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /\bdaemon\b/.test(command)
}

async function executeForStdout(
  executeFileImpl: typeof execFile,
  file: string,
  args: readonly string[],
): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    executeFileImpl(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1_000 }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      resolve(stdout)
    })
  })
}

async function readText(
  readFileImpl: typeof readFile,
  path: string,
): Promise<string | null> {
  return await readFileImpl(path, "utf8").catch(() => null)
}

async function readBinary(
  readFileImpl: typeof readFile,
  path: string,
): Promise<Buffer | null> {
  return await readFileImpl(path).catch(() => null)
}
