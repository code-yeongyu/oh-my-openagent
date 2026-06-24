import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

export const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH"
export const WINGET_INSTALL_ARGS = ["install", "--id", "Git.Git", "-e", "--source", "winget"] as const

const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
const NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS = ["\\windows\\system32\\", "\\microsoft\\windowsapps\\"] as const

export type GitBashSource = "not-required" | "env" | "program-files" | "program-files-x86" | "path"

export type GitBashResolution =
  | {
      readonly found: true
      readonly path: string | null
      readonly source: GitBashSource
      readonly checkedPaths: readonly string[]
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
  if (input.platform !== "win32") return { found: true, path: null, source: "not-required", checkedPaths: [] }

  const checkedPaths: string[] = []
  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY)
  if (envPath !== undefined) {
    checkedPaths.push(envPath)
    if (isBashExePath(envPath) && input.exists(envPath)) {
      return { found: true, path: envPath, source: "env", checkedPaths }
    }

    return missingGitBash(checkedPaths)
  }

  for (const candidate of [
    { path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
    { path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" },
  ] as const) {
    checkedPaths.push(candidate.path)
    if (input.exists(candidate.path)) return { found: true, path: candidate.path, source: candidate.source, checkedPaths }
  }

  for (const pathCandidate of input.where("bash")) {
    const candidate = pathCandidate.trim()
    if (candidate.length === 0) continue
    checkedPaths.push(candidate)
    if (isKnownNonGitBashLauncher(candidate)) continue
    if (isBashExePath(candidate) && input.exists(candidate)) return { found: true, path: candidate, source: "path", checkedPaths }
  }

  return missingGitBash(checkedPaths)
}

export const resolveGitBashForCurrentProcess = (input: {
  readonly platform?: string
  readonly env?: { readonly [key: string]: string | undefined }
} = {}): GitBashResolution => {
  return resolveGitBash({
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    exists: existsSync,
    where: whereCommand,
  })
}

function missingGitBash(checkedPaths: readonly string[]): GitBashResolution {
  return {
    found: false,
    checkedPaths,
    installHint: [
      "Git Bash is required on native Windows.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`,
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
