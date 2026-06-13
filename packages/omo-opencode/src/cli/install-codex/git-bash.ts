import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import type { RunCommand } from "./types"

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH"
const SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY = "OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL"
const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
const WINGET_INSTALL_ARGS = ["install", "--id", "Git.Git", "-e", "--source", "winget"] as const

export type GitBashSource = "not-required" | "env" | "program-files" | "program-files-x86" | "path"

export type GitBashResolution =
  | {
    readonly found: true
    readonly path: string | null
    readonly source: GitBashSource
  }
  | {
    readonly found: false
    readonly checkedPaths: readonly string[]
    readonly installHint: string
  }

export interface GitBashResolverInput {
  readonly platform: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly exists: (path: string) => boolean
  readonly where: (command: "bash") => readonly string[]
}

export function resolveGitBash(input: GitBashResolverInput): GitBashResolution {
  if (input.platform !== "win32") return { found: true, path: null, source: "not-required" }

  const checkedPaths: string[] = []
  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY)
  if (envPath !== undefined) {
    checkedPaths.push(envPath)
    if (isBashExePath(envPath) && input.exists(envPath)) return { found: true, path: envPath, source: "env" }
    return missingGitBash(checkedPaths)
  }

  for (const candidate of [
    { path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
    { path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" },
  ] as const) {
    checkedPaths.push(candidate.path)
    if (input.exists(candidate.path)) return { found: true, path: candidate.path, source: candidate.source }
  }

  for (const pathCandidate of input.where("bash")) {
    const candidate = pathCandidate.trim()
    if (candidate.length === 0) continue
    checkedPaths.push(candidate)
    if (isKnownNonGitBashLauncher(candidate)) continue
    if (isBashExePath(candidate) && input.exists(candidate)) return { found: true, path: candidate, source: "path" }
  }

  return missingGitBash(checkedPaths)
}

export function resolveGitBashForCurrentProcess(input: {
  readonly platform?: string
  readonly env?: { readonly [key: string]: string | undefined }
} = {}): GitBashResolution {
  return resolveGitBash({
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    exists: existsSync,
    where: whereCommand,
  })
}

export async function prepareGitBashForInstall(input: {
  readonly platform: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly cwd: string
  readonly runCommand: RunCommand
  readonly resolveGitBash?: () => GitBashResolution
}): Promise<GitBashResolution> {
  const resolve = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess({ platform: input.platform, env: input.env }))
  const initialResolution = resolve()
  if (input.platform !== "win32" || initialResolution.found) return initialResolution
  if (input.env[SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY] === "1") return initialResolution

  try {
    await input.runCommand("winget", WINGET_INSTALL_ARGS, { cwd: input.cwd })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return initialResolution
  }

  return resolve()
}

function missingGitBash(checkedPaths: readonly string[]): GitBashResolution {
  return {
    found: false,
    checkedPaths,
    installHint: [
      "Git Bash is required for native Windows Codex profile installs.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`,
      "Then rerun `npx lazycodex-ai install`.",
    ].join("\n"),
  }
}

function nonEmptyEnvValue(env: { readonly [key: string]: string | undefined }, key: string): string | undefined {
  const value = env[key]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function isBashExePath(path: string): boolean {
  return path.toLowerCase().endsWith("bash.exe")
}

const NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS = ["\\windows\\system32\\", "\\microsoft\\windowsapps\\"] as const

function isKnownNonGitBashLauncher(path: string): boolean {
  const normalized = path.replaceAll("/", "\\").toLowerCase()
  return NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS.some((segment) => normalized.includes(segment))
}

function whereCommand(command: "bash"): readonly string[] {
  try {
    return execFileSync("where", [command], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (error) {
    if (error instanceof Error) return []
    throw error
  }
}
