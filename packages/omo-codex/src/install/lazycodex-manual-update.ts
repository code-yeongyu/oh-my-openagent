import { spawn, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { RunCommand } from "./types"

const DEFAULT_UPDATE_COMMAND = "npx"
const DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"] as const
const INSTALLED_VERSION_FILE = "lazycodex-install.json"

type Version = {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string | undefined
}

type LazyCodexUpdatePlan =
  | { readonly shouldUpdate: false; readonly reason: "unknown-current" | "unknown-latest" | "up-to-date" }
  | { readonly shouldUpdate: true; readonly command: string; readonly args: readonly string[] }

export async function runLazyCodexManualUpdate(input: {
  readonly env?: NodeJS.ProcessEnv
  readonly dryRun?: boolean
  readonly log?: (line: string) => void
  readonly runCommand?: RunCommand
} = {}): Promise<number> {
  const env = input.env ?? process.env
  const log = input.log ?? console.log
  const commandRunner = input.runCommand ?? defaultRunCommandForManualUpdate
  const currentVersion = resolveCurrentVersion(env)
  const latestVersion = resolveLatestVersion(env)
  const plan = resolveLazyCodexUpdatePlan({
    currentVersion,
    latestVersion,
    command: resolveCommand(env),
    args: resolveArgs(env),
  })
  if (!plan.shouldUpdate) {
    const printableVersion = currentVersion ?? "unknown"
    log(plan.reason === "up-to-date"
      ? `lazycodex-ai ${printableVersion} is already up to date.`
      : `Unable to check lazycodex-ai updates (${plan.reason}).`)
    return plan.reason === "up-to-date" ? 0 : 1
  }
  if (input.dryRun) {
    log(`${plan.command} ${plan.args.join(" ")}`)
    return 0
  }
  await commandRunner(plan.command, plan.args, { cwd: process.cwd(), env })
  return 0
}

function resolveLazyCodexUpdatePlan(input: {
  readonly currentVersion?: string
  readonly latestVersion?: string
  readonly command?: string
  readonly args?: readonly string[]
} = {}): LazyCodexUpdatePlan {
  const current = parseVersion(input.currentVersion)
  if (current === null) return { shouldUpdate: false, reason: "unknown-current" }
  const latest = parseVersion(input.latestVersion)
  if (latest === null) return { shouldUpdate: false, reason: "unknown-latest" }
  if (compareVersions(latest, current) <= 0) return { shouldUpdate: false, reason: "up-to-date" }
  return { shouldUpdate: true, command: input.command ?? DEFAULT_UPDATE_COMMAND, args: input.args ?? DEFAULT_UPDATE_ARGS }
}

function resolveCommand(env: NodeJS.ProcessEnv): string {
  return env.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND
}

function resolveArgs(env: NodeJS.ProcessEnv): readonly string[] {
  if (env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
    const parsed: unknown = JSON.parse(env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array")
    }
    return parsed
  }
  return DEFAULT_UPDATE_ARGS
}

function resolveCurrentVersion(env: NodeJS.ProcessEnv): string | undefined {
  if (env.LAZYCODEX_CURRENT_VERSION?.trim()) return env.LAZYCODEX_CURRENT_VERSION.trim()
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  return (
    readVersionManifest(resolveInstalledVersionPath(env, pluginRoot)) ??
    readVersionManifest(join(pluginRoot, "..", "..", "..", "package.json")) ??
    readVersionManifest(join(pluginRoot, ".codex-plugin", "plugin.json"))
  )
}

function resolveLatestVersion(env: NodeJS.ProcessEnv): string | undefined {
  if (env.LAZYCODEX_LATEST_VERSION?.trim()) return env.LAZYCODEX_LATEST_VERSION.trim()
  const result = spawnSync("npm", ["view", "lazycodex-ai", "version", "--silent"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status !== 0) return undefined
  const version = result.stdout.trim()
  return version.length > 0 ? version : undefined
}

function defaultRunCommandForManualUpdate(command: string, args: readonly string[], options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: false,
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`))
    })
  })
}

function parseVersion(version: string | undefined): Version | null {
  if (typeof version !== "string") return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version.trim())
  if (match === null) return null
  const major = Number.parseInt(match[1] ?? "", 10)
  const minor = Number.parseInt(match[2] ?? "", 10)
  const patch = Number.parseInt(match[3] ?? "", 10)
  const prerelease = match[4]
  return Number.isFinite(major) && Number.isFinite(minor) && Number.isFinite(patch)
    ? { major, minor, patch, prerelease }
    : null
}

function compareVersions(left: Version, right: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const leftValue = left[key]
    const rightValue = right[key]
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  if (left.prerelease === undefined && right.prerelease !== undefined) return 1
  if (left.prerelease !== undefined && right.prerelease === undefined) return -1
  if (left.prerelease !== undefined && right.prerelease !== undefined) {
    return left.prerelease.localeCompare(right.prerelease)
  }
  return 0
}

function resolveInstalledVersionPath(env: NodeJS.ProcessEnv, pluginRoot: string): string {
  if (env.LAZYCODEX_INSTALLED_VERSION_FILE?.trim()) return env.LAZYCODEX_INSTALLED_VERSION_FILE.trim()
  return join(pluginRoot, INSTALLED_VERSION_FILE)
}

function readVersionManifest(path: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
      return parsed.version
    }
    return undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    return undefined
  }
}
