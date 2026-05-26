/**
 * Doctor check: detect multiple OmO/opencode-family installs on PATH and warn
 * when their reported `--version` outputs disagree (#4451).
 *
 * The original report showed three distinct version strings ("CLI 3.17.5",
 * "toast 4.0.0", "doctor 4.4.0") from a single shell — a classic symptom of
 * stale binaries from earlier npm package names (`oh-my-opencode`) lingering
 * on PATH after a rename to `oh-my-openagent`. This check finds those stale
 * binaries up-front so the user does not chase version-drift ghosts.
 */
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnWithTimeout } from "../spawn-with-timeout"
import type { CheckResult, DoctorIssue } from "../types"

/** Binary basenames we consider part of the OmO family. */
const FAMILY_BINARIES = ["oh-my-opencode", "oh-my-openagent"] as const

/** Trailing executable suffixes to probe on Windows. Unix uses no suffix. */
const WINDOWS_EXECUTABLE_SUFFIXES = [".exe", ".cmd", ".bat", ""] as const

export interface InstallEntry {
  binary: string
  path: string
  version: string | null
}

export interface ScanDeps {
  pathEntries: string[]
  platform: NodeJS.Platform
  resolveVersion: (binaryPath: string) => Promise<string | null>
}

function getPathEntries(): string[] {
  const raw = process.env.PATH ?? ""
  const sep = process.platform === "win32" ? ";" : ":"
  return raw.split(sep).filter((entry) => entry.length > 0)
}

async function resolveVersionViaSpawn(binaryPath: string): Promise<string | null> {
  try {
    const result = await spawnWithTimeout([binaryPath, "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) return null
    const text = (result.stdout || result.stderr).trim()
    // The CLI prints just the version string via commander's .version().
    // Be tolerant of either bare versions ("4.4.0") or prefixed ("oh-my-opencode 4.4.0").
    const match = text.match(/(\d+\.\d+\.\d+(?:-[\w.+-]+)?)/)
    return match?.[1] ?? text.split("\n")[0]?.trim() ?? null
  } catch {
    return null
  }
}

function candidatePathsFor(directory: string, binary: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return WINDOWS_EXECUTABLE_SUFFIXES.map((suffix) => join(directory, `${binary}${suffix}`))
  }
  return [join(directory, binary)]
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    if (!existsSync(candidatePath)) return false
    const stat = statSync(candidatePath)
    return stat.isFile()
  } catch {
    return false
  }
}

export async function scanFamilyInstalls(deps?: Partial<ScanDeps>): Promise<InstallEntry[]> {
  const pathEntries = deps?.pathEntries ?? getPathEntries()
  const platform = deps?.platform ?? process.platform
  const resolveVersion = deps?.resolveVersion ?? resolveVersionViaSpawn

  const found: InstallEntry[] = []
  const seenPaths = new Set<string>()

  for (const directory of pathEntries) {
    for (const binary of FAMILY_BINARIES) {
      for (const candidate of candidatePathsFor(directory, binary, platform)) {
        if (seenPaths.has(candidate)) continue
        if (!isExecutableFile(candidate)) continue
        seenPaths.add(candidate)
        const version = await resolveVersion(candidate)
        found.push({ binary, path: candidate, version })
      }
    }
  }

  return found
}

export function summarizeShadowing(entries: InstallEntry[]): {
  status: "pass" | "warn"
  distinctVersions: string[]
  pathsByVersion: Record<string, string[]>
} {
  const pathsByVersion: Record<string, string[]> = {}
  for (const entry of entries) {
    // Treat entries with no version as their own bucket so we surface broken
    // binaries instead of silently collapsing them with healthy ones.
    const key = entry.version ?? `unresolved:${entry.path}`
    if (!pathsByVersion[key]) pathsByVersion[key] = []
    pathsByVersion[key].push(entry.path)
  }
  const distinctVersions = Object.keys(pathsByVersion)
  const status = distinctVersions.length > 1 ? "warn" : "pass"
  return { status, distinctVersions, pathsByVersion }
}

export async function checkInstallShadowing(deps?: Partial<ScanDeps>): Promise<CheckResult> {
  const started = Date.now()
  const entries = await scanFamilyInstalls(deps)

  if (entries.length === 0) {
    return {
      name: "Install Shadowing",
      status: "skip",
      message: "No OmO binaries found on PATH",
      issues: [],
      duration: Date.now() - started,
    }
  }

  const summary = summarizeShadowing(entries)

  if (summary.status === "pass") {
    const onlyVersion = summary.distinctVersions[0] ?? "unknown"
    return {
      name: "Install Shadowing",
      status: "pass",
      message: `Single OmO version on PATH: ${onlyVersion}`,
      details: entries.map((entry) => `${entry.path} -> ${entry.version ?? "unresolved"}`),
      issues: [],
      duration: Date.now() - started,
    }
  }

  const lines = summary.distinctVersions.map((version) => {
    const paths = summary.pathsByVersion[version] ?? []
    return `${version}: ${paths.join(", ")}`
  })

  const issue: DoctorIssue = {
    title: "Multiple OmO installs on PATH report different versions",
    description:
      `Found ${entries.length} OmO/openagent binaries on PATH with ${summary.distinctVersions.length} distinct versions. ` +
      `A stale binary from an earlier package name (oh-my-opencode) commonly shadows the current install and causes ` +
      `version-mismatch reports between the CLI, toast notifications, and doctor.`,
    fix:
      "Uninstall the older packages: `npm uninstall -g oh-my-opencode` (and any other shadowing binary) then re-run " +
      "`npm install -g oh-my-openagent` so a single binary remains on PATH.",
    affects: entries.map((entry) => entry.path),
    severity: "warning",
  }

  return {
    name: "Install Shadowing",
    status: "warn",
    message: `Found ${summary.distinctVersions.length} distinct OmO versions on PATH`,
    details: lines,
    issues: [issue],
    duration: Date.now() - started,
  }
}
