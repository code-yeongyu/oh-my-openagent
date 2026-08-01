import { execFile } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

import { defaultIsProcessAlive } from "./exec"
import {
  attestLspDaemonOwner,
  parseLspDaemonOwner,
  type LspDaemonOwnerTarget,
} from "./lsp-daemon-owner-attestation"

/**
 * Stale old-version lsp-daemon family.
 *
 * BOUNDARY: packages/utils cannot import the vendored `@code-yeongyu/lsp-daemon`
 * package (and lsp-daemon cannot import omo packages), so its owner record and
 * authenticated `daemon/ping` proof are mirrored locally. Generic argv matching
 * remains exported for legacy callers but never authorizes stale-version kills.
 * The base-dir, auth-token, owner-file, and ping layouts mirror
 * packages/lsp-daemon/src/{paths,auth,ownership,ensure-daemon}.ts and must change
 * in lockstep with that package.
 *
 * Scope: this family only KILLS provably stale daemon processes. Version-dir
 * removal stays with version-reap.ts, which runs at daemon startup with full
 * ownership context.
 */

export const OMO_LSP_DAEMON_DIR_ENV = "OMO_LSP_DAEMON_DIR"
export const OMO_LSP_DAEMON_VERSION_ENV = "OMO_LSP_DAEMON_VERSION"

export interface LspDaemonBaseDirOptions {
  readonly env?: Record<string, string | undefined>
  readonly homeDir?: string
  readonly lspDaemonDir?: string
}

export function resolveLspDaemonBaseDir(options: LspDaemonBaseDirOptions = {}): string {
  if (options.lspDaemonDir !== undefined && options.lspDaemonDir.trim().length > 0) {
    return resolve(options.lspDaemonDir)
  }
  const env = options.env ?? process.env
  const override = env[OMO_LSP_DAEMON_DIR_ENV]
  if (override !== undefined && override.trim().length > 0) return resolve(override)
  const homeDir = options.homeDir ?? env["HOME"] ?? env["USERPROFILE"] ?? homedir()
  return join(homeDir, ".omo", "lsp-daemon")
}

export interface LspDaemonVersionDir {
  readonly dir: string
  readonly version: string
}

const VERSION_ENTRY_PATTERN = /^v([A-Za-z0-9][A-Za-z0-9._+-]{0,127})$/

export function listLspDaemonVersionDirs(baseDir: string): LspDaemonVersionDir[] {
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error) return []
    throw error
  }
  const versions: LspDaemonVersionDir[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const version = VERSION_ENTRY_PATTERN.exec(entry.name)?.[1]
    if (version === undefined) continue
    versions.push({ dir: join(baseDir, entry.name), version })
  }
  return versions.sort((left, right) => left.version.localeCompare(right.version))
}

/**
 * Reads the owner pid from `<versionDir>/daemon.owner`. Mirrors the shape
 * written by packages/lsp-daemon/src/ownership.ts writeDaemonOwner. The full
 * owner identity is preserved so every signal can be authorized by endpoint,
 * nonce, process id, and start identity. Unparseable bodies fail closed.
 */
export function readLspDaemonOwnerTarget(versionDir: string): LspDaemonOwnerTarget | null {
  const ownerPath = join(versionDir, "daemon.owner")
  let raw: string
  try {
    raw = requireOwnerText(ownerPath)
  } catch {
    return null
  }
  try {
    const owner = parseLspDaemonOwner(JSON.parse(raw))
    if (owner === null) return null
    return { authPath: join(versionDir, "daemon.auth"), owner, ownerPath, pid: owner.pid }
  } catch {
    return null
  }
}

export function readLspDaemonOwnerPid(versionDir: string): number | null {
  return readLspDaemonOwnerTarget(versionDir)?.pid ?? null
}

function requireOwnerText(path: string): string {
  return readFileSync(path, "utf8")
}

export interface LspDaemonAttestationDeps {
  readonly readProcFile?: (path: string) => Promise<Buffer>
  readonly executeForStdout?: (file: string, args: readonly string[]) => Promise<string | null>
}

/**
 * Local mirror of packages/lsp-daemon/src/version-reap.ts
 * attestDaemonCliProcess (keep in lockstep): a pid is an attested lsp-daemon
 * server only when its cmdline shows node running the lsp-daemon cli with the
 * `daemon` identity arg. Windows fails closed (named-pipe policy).
 */
export async function attestLspDaemonCliProcess(
  pid: number,
  platform: NodeJS.Platform,
  deps: LspDaemonAttestationDeps = {},
): Promise<boolean> {
  if (platform === "win32") return false
  if (platform === "linux") {
    const readProcFile = deps.readProcFile ?? defaultReadProcFile
    const cmdline = await readProcFile(`/proc/${pid}/cmdline`).catch(() => null)
    if (cmdline === null) return false
    return isNodeCliDaemonArgv(splitCmdline(cmdline))
  }
  const executeForStdout = deps.executeForStdout ?? defaultExecuteForStdout
  const command = await executeForStdout("/bin/ps", ["-p", String(pid), "-o", "command="])
  if (command === null) return false
  return isNodeCliDaemonCommand(command.trim())
}

export interface StaleLspDaemonVersionTarget extends LspDaemonOwnerTarget {
  readonly version: string
  readonly versionDir: string
}

export interface SparedLspDaemonVersion extends StaleLspDaemonVersionTarget {
  readonly reason: "attestation-failed" | "windows-attestation-unsupported"
}

export interface StaleLspDaemonVersionSweepPlan {
  readonly spared: readonly SparedLspDaemonVersion[]
  readonly targets: readonly StaleLspDaemonVersionTarget[]
}

export interface PlanStaleLspDaemonVersionSweepOptions {
  readonly attest?: (pid: number, platform: NodeJS.Platform) => Promise<boolean>
  readonly attestTarget?: (target: StaleLspDaemonVersionTarget, platform: NodeJS.Platform) => Promise<boolean>
  readonly baseDir: string
  readonly currentVersion: string
  readonly isAlive?: (pid: number) => boolean
  readonly log?: (message: string) => void
  readonly platform?: NodeJS.Platform
}

/**
 * Plans the stale-version sweep: for every version dir != the current
 * version, the owner pid is a kill target only when it is alive AND attested
 * as a real lsp-daemon server. Anything unprovable is spared (a wrong call
 * here kills a live shared daemon or an innocent recycled pid).
 */
export async function planStaleLspDaemonVersionSweep(
  options: PlanStaleLspDaemonVersionSweepOptions,
): Promise<StaleLspDaemonVersionSweepPlan> {
  const platform = options.platform ?? process.platform
  const isAlive = options.isAlive ?? defaultIsProcessAlive
  const attestTarget = options.attestTarget
    ?? (options.attest === undefined
      ? (target: StaleLspDaemonVersionTarget) => attestLspDaemonOwner(target)
      : (target: StaleLspDaemonVersionTarget) => options.attest!(target.pid, platform))
  const targets: StaleLspDaemonVersionTarget[] = []
  const spared: SparedLspDaemonVersion[] = []

  for (const entry of listLspDaemonVersionDirs(options.baseDir)) {
    if (entry.version === options.currentVersion) continue
    const ownerTarget = readLspDaemonOwnerTarget(entry.dir)
    if (ownerTarget === null) continue
    if (!isAlive(ownerTarget.pid)) continue
    const target = { ...ownerTarget, version: entry.version, versionDir: entry.dir }
    const pid = target.pid
    if (platform === "win32") {
      options.log?.(
        `lsp-daemon stale-version sweep sparing v${entry.version}: Windows cannot prove pid ownership safely (named-pipe policy)`,
      )
      spared.push({ ...target, reason: "windows-attestation-unsupported" })
      continue
    }
    if (!(await attestTarget(target, platform))) {
      options.log?.(
        `lsp-daemon stale-version sweep sparing v${entry.version}: pid ${pid} is alive but owner identity attestation failed (possible recycled pid)`,
      )
      spared.push({ ...target, reason: "attestation-failed" })
      continue
    }
    targets.push(target)
  }

  return { spared, targets }
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

function isNodeCliDaemonCommand(command: string): boolean {
  // NOTE: version-reap.ts uses /\bdaemon\b/, which also matches inside
  // "lsp-daemon"; the token-strict form here only ever attests FEWER
  // processes (spares more), which is the safe direction for a kill gate.
  return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /(?:^|\s)daemon(?:\s|$)/.test(command)
}

function defaultReadProcFile(path: string): Promise<Buffer> {
  return readFile(path)
}

function defaultExecuteForStdout(file: string, args: readonly string[]): Promise<string | null> {
  return new Promise<string | null>((resolvePromise) => {
    execFile(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1_000 }, (error, stdout) => {
      if (error !== null) {
        resolvePromise(null)
        return
      }
      resolvePromise(stdout)
    })
  })
}
