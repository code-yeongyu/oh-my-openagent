/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { createHash } from "node:crypto"
import type { ChildProcessByStdio } from "node:child_process"
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { platform, tmpdir } from "node:os"
import { join, posix, win32 } from "node:path"
import type { Readable } from "node:stream"

export interface LegacyDaemonFixture {
  readonly codexHome: string
  readonly version: string
  readonly versionDir: string
  readonly endpoint: string
}

export type SpawnedChild = ChildProcessByStdio<null, Readable, Readable>
type LegacyEndpointKind = "natural" | "hashed" | "windowsPipe"

function nodeBinary(): string {
  if (process.env.NODE_BINARY) return process.env.NODE_BINARY
  if (platform() === "win32") {
    const candidate = firstCommandLine("where.exe", ["node"]) ?? firstCommandLine("which", ["node"])
    if (candidate) return normalizeWindowsNodeCandidate(candidate)
  }
  return execFileSync("which", ["node"], { encoding: "utf8" }).trim()
}

function firstCommandLine(command: string, args: readonly string[]): string | null {
  try {
    const output = execFileSync(command, [...args], { encoding: "utf8" })
    return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? null
  } catch {
    return null
  }
}

export function normalizeWindowsNodeCandidate(candidate: string): string {
  const path = candidate.split(";")[0]?.trim() ?? candidate
  const msysPath = /^\/([a-zA-Z])\/(.*)$/.exec(path)
  if (!msysPath) return path
  const nativePath = `${msysPath[1].toUpperCase()}:\\${msysPath[2].replaceAll("/", "\\")}`
  return /\.[^\\/]+$/.test(nativePath) ? nativePath : `${nativePath}.exe`
}

export function createLegacyCodexHome(prefix: string): string {
  const root = platform() === "win32" ? tmpdir() : "/tmp"
  return mkdtempSync(join(root, prefix))
}

export function versionDirFor(codexHome: string, version: string): string {
  return pathJoinForRoot(codexHome, "codex-lsp", "daemon", `v${version}`)
}

export function legacyEndpointFor(input: {
  readonly codexHome: string
  readonly version: string
  readonly kind: LegacyEndpointKind
  readonly platform?: NodeJS.Platform
  readonly tempDir?: string
}): string {
  const versionDir = versionDirFor(input.codexHome, input.version)
  if (input.kind === "natural") return endpointPathJoin(input.platform ?? platform(), versionDir, "daemon.sock")
  if (input.kind === "windowsPipe") return legacyWindowsPipeEndpoint(versionDir, input.version)
  const digest = createHash("sha256").update(versionDir).digest("hex").slice(0, 16)
  return endpointPathJoin(input.platform ?? platform(), input.tempDir ?? tmpdir(), `omo-lsp-${input.version}-${digest}.sock`)
}

export function liveLegacyEndpointFor(input: {
  readonly codexHome: string
  readonly version: string
  readonly platform?: NodeJS.Platform
}): string {
  const targetPlatform = input.platform ?? platform()
  return legacyEndpointFor({
    codexHome: input.codexHome,
    version: input.version,
    kind: targetPlatform === "win32" ? "windowsPipe" : "natural",
    platform: targetPlatform,
  })
}

function endpointPathJoin(targetPlatform: NodeJS.Platform, root: string, leaf: string): string {
  return targetPlatform === "win32" ? win32.join(root, leaf) : posix.join(root, leaf)
}

function pathJoinForRoot(root: string, ...segments: readonly string[]): string {
  return isNativeWindowsPath(root) ? win32.join(root, ...segments) : join(root, ...segments)
}

function isNativeWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\")
}

function legacyWindowsPipeEndpoint(versionDir: string, version: string): string {
  const digest = createHash("sha256").update(versionDir.replaceAll("/", "\\")).digest("hex").slice(0, 16)
  return `\\\\.\\pipe\\omo-lsp-${version}-${digest}`
}

function isWindowsNamedPipeEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("\\\\.\\pipe\\")
}

export async function writeLegacyVersionState(input: {
  readonly codexHome: string
  readonly version: string
  readonly pid: string
  readonly endpoint: string
}): Promise<LegacyDaemonFixture> {
  const versionDir = versionDirFor(input.codexHome, input.version)
  await mkdir(versionDir, { recursive: true })
  await writeFile(join(versionDir, "daemon.pid"), `${input.pid}\n`)
  await writeFile(join(versionDir, "daemon.endpoint"), `${input.endpoint}\n`)
  return { codexHome: input.codexHome, version: input.version, versionDir, endpoint: input.endpoint }
}

export async function writeSymlinkedLegacyMetadata(input: {
  readonly codexHome: string
  readonly version: string
  readonly targetPath: string
}): Promise<LegacyDaemonFixture> {
  const versionDir = versionDirFor(input.codexHome, input.version)
  await mkdir(versionDir, { recursive: true })
  await writeFile(input.targetPath, "123\n")
  await symlink(input.targetPath, join(versionDir, "daemon.pid"))
  await symlink(input.targetPath, join(versionDir, "daemon.endpoint"))
  return {
    codexHome: input.codexHome,
    version: input.version,
    versionDir,
    endpoint: legacyEndpointFor({ codexHome: input.codexHome, version: input.version, kind: "natural" }),
  }
}

export function startLegacyDaemonProcess(input: {
  readonly endpoint: string
  readonly ignoreSigterm?: boolean
  readonly holdSocketOpen?: boolean
}): SpawnedChild {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "legacy-lsp-daemon-child-"))
  const cliPath = join(fixtureRoot, "cli.js")
  const source = [
    'const { createServer } = require("node:net")',
    'const { mkdirSync, unlinkSync } = require("node:fs")',
    'const { dirname } = require("node:path")',
    "const endpoint = process.env.LEGACY_ENDPOINT",
    "const holdSocketOpen = process.env.LEGACY_HOLD_SOCKET_OPEN === \"1\"",
    "const isWindowsPipe = endpoint.startsWith('\\\\\\\\.\\\\pipe\\\\')",
    "if (process.env.LEGACY_IGNORE_SIGTERM === \"1\") process.on(\"SIGTERM\", () => {})",
    "if (!isWindowsPipe) mkdirSync(dirname(endpoint), { recursive: true })",
    "if (!isWindowsPipe) { try { unlinkSync(endpoint) } catch {} }",
    "const server = createServer((socket) => {",
    "  let buffer = ''",
    "  socket.on('data', (chunk) => {",
    "    buffer += chunk.toString('utf8')",
    "    for (;;) {",
    "      const newlineIndex = buffer.indexOf('\\n')",
    "      if (newlineIndex < 0) break",
    "      const line = buffer.slice(0, newlineIndex).trim()",
    "      buffer = buffer.slice(newlineIndex + 1)",
    "      if (line.length === 0) continue",
    "      const message = JSON.parse(line)",
    "      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })}\\n`)",
    "      if (!holdSocketOpen) socket.end()",
    "    }",
    "  })",
    "})",
    "const closeAndExit = () => server.close(() => process.exit(0))",
    "if (process.env.LEGACY_IGNORE_SIGTERM !== '1') process.on('SIGTERM', closeAndExit)",
    "process.on('SIGINT', closeAndExit)",
    "server.listen(endpoint, () => process.stdout.write('ready\\n'))",
  ].join("\n")
  writeFileSync(cliPath, `${source}\n`)
  const child = spawn(nodeBinary(), [cliPath, "daemon"], {
    env: {
      ...process.env,
      LEGACY_ENDPOINT: input.endpoint,
      LEGACY_IGNORE_SIGTERM: input.ignoreSigterm === true ? "1" : "0",
      LEGACY_HOLD_SOCKET_OPEN: input.holdSocketOpen === true ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return child
}

export function startIdleNodeProcess(): SpawnedChild {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "legacy-lsp-daemon-idle-"))
  const scriptPath = join(fixtureRoot, "idle.js")
  writeFileSync(scriptPath, "setInterval(() => undefined, 1_000)\n")
  return spawn(nodeBinary(), [scriptPath], { stdio: ["ignore", "pipe", "pipe"] })
}

export async function waitForChildReady(child: SpawnedChild): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("legacy daemon fixture did not report ready")), 5_000)
    const onData = (chunk: Buffer): void => {
      if (!chunk.toString("utf8").includes("ready")) return
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      resolve()
    }
    child.stdout.on("data", onData)
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`legacy daemon fixture exited before ready (code=${code ?? "null"} signal=${signal ?? "null"})`))
    })
  })
}

export async function waitForChildExit(child: SpawnedChild, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export async function stopChild(child: SpawnedChild): Promise<void> {
  if (child.exitCode !== null) return
  child.kill("SIGKILL")
  await waitForChildExit(child, 1_000)
}

export async function removePathIfPresent(path: string): Promise<void> {
  if (isWindowsNamedPipeEndpoint(path)) return
  await rm(path, { recursive: true, force: true })
}
