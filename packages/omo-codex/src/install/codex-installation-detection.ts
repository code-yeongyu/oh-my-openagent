import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { posix, win32 } from "node:path"
import { bunWhich } from "../../../omo-opencode/src/shared/bun-which-shim"
import type { CodexInstallPlatform } from "./types"

export type CodexInstallationSource = "cli" | "mac-app" | "windows-standard-cli" | "windows-start-app"
type CodexInstallationPathSource = Exclude<CodexInstallationSource, "windows-start-app">

export type CodexInstallationDetection =
  | {
    readonly found: true
    readonly source: CodexInstallationPathSource
    readonly path: string
  }
  | {
    readonly found: true
    readonly source: "windows-start-app"
    readonly appId: string
  }
  | {
    readonly found: false
    readonly checkedPaths: readonly string[]
    readonly hint: string
    readonly downloadedInstallerPath?: string
  }

export interface CodexInstallationCommandResult {
  readonly success: boolean
  readonly stdout: string
}

export interface CodexInstallationDetectorInput {
  readonly platform?: CodexInstallPlatform
  readonly env?: { readonly [key: string]: string | undefined }
  readonly homeDir?: string
  readonly exists?: (path: string) => boolean
  readonly which?: (command: "codex") => string | null | undefined
  readonly runCommand?: (
    command: string,
    args: readonly string[],
  ) => Promise<CodexInstallationCommandResult>
}

const CODEX_PATH_CHECK_LABEL = "codex (PATH)"
const WINDOWS_START_APPS_ARGS = [
  "-NoProfile",
  "-Command",
  "Get-StartApps -Name 'Codex' | Select-Object -First 1 -ExpandProperty AppID",
] as const

export async function detectCodexInstallation(
  input: CodexInstallationDetectorInput = {},
): Promise<CodexInstallationDetection> {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const homeDir = input.homeDir ?? homedir()
  const exists = input.exists ?? existsSync
  const which = input.which ?? bunWhich
  const checkedPaths: string[] = [CODEX_PATH_CHECK_LABEL]
  const cliPath = nonEmptyValue(which("codex"))
  if (cliPath !== undefined) return { found: true, source: "cli", path: cliPath }

  if (platform === "darwin") {
    return detectMacCodexInstallation({ homeDir, exists, checkedPaths })
  }

  if (platform === "win32") {
    return detectWindowsCodexInstallation({
      env,
      exists,
      checkedPaths,
      runCommand: input.runCommand ?? defaultRunCommand,
    })
  }

  return missingCodexInstallation(checkedPaths, "Install OpenAI Codex CLI and make sure `codex` is on PATH.")
}

export function formatCodexInstallationWarning(detection: Extract<CodexInstallationDetection, { readonly found: false }>): string {
  return [
    "Codex CLI or desktop app was not detected. LazyCodex will still install the Codex plugin, but Codex itself must be installed to use it.",
    detection.hint,
    `Checked: ${detection.checkedPaths.join(", ")}`,
  ].join("\n")
}

function detectMacCodexInstallation(input: {
  readonly homeDir: string
  readonly exists: (path: string) => boolean
  readonly checkedPaths: string[]
}): CodexInstallationDetection {
  for (const appPath of macCodexAppPaths(input.homeDir)) {
    input.checkedPaths.push(appPath)
    if (input.exists(appPath)) return { found: true, source: "mac-app", path: appPath }
  }

  for (const dmgPath of macCodexDmgPaths(input.homeDir)) {
    input.checkedPaths.push(dmgPath)
    if (input.exists(dmgPath)) {
      return missingCodexInstallation(
        input.checkedPaths,
        `Open ${dmgPath} to install Codex Desktop, or install OpenAI Codex CLI and make sure \`codex\` is on PATH.`,
        dmgPath,
      )
    }
  }

  return missingCodexInstallation(
    input.checkedPaths,
    "Install OpenAI Codex CLI, or install Codex Desktop for macOS.",
  )
}

async function detectWindowsCodexInstallation(input: {
  readonly env: { readonly [key: string]: string | undefined }
  readonly exists: (path: string) => boolean
  readonly checkedPaths: string[]
  readonly runCommand: (
    command: string,
    args: readonly string[],
  ) => Promise<CodexInstallationCommandResult>
}): Promise<CodexInstallationDetection> {
  for (const candidate of windowsCodexCliPaths(input.env)) {
    input.checkedPaths.push(candidate)
    if (input.exists(candidate)) return { found: true, source: "windows-standard-cli", path: candidate }
  }

  input.checkedPaths.push("Windows Start Apps: Codex")
  const appId = await findWindowsCodexStartApp(input.runCommand)
  if (appId !== null) return { found: true, source: "windows-start-app", appId }

  return missingCodexInstallation(
    input.checkedPaths,
    "Install OpenAI Codex CLI, or install Codex Desktop from Microsoft Store.",
  )
}

async function findWindowsCodexStartApp(
  runCommand: (
    command: string,
    args: readonly string[],
  ) => Promise<CodexInstallationCommandResult>,
): Promise<string | null> {
  try {
    const result = await runCommand("powershell.exe", WINDOWS_START_APPS_ARGS)
    if (!result.success) return null
    return nonEmptyValue(result.stdout.trim()) ?? null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function macCodexAppPaths(homeDir: string): readonly string[] {
  return ["/Applications/Codex.app", posix.join(homeDir, "Applications", "Codex.app")]
}

function macCodexDmgPaths(homeDir: string): readonly string[] {
  const downloads = posix.join(homeDir, "Downloads")
  return [posix.join(downloads, "codex.dmg"), posix.join(downloads, "Codex.dmg")]
}

function windowsCodexCliPaths(env: { readonly [key: string]: string | undefined }): readonly string[] {
  const candidates: string[] = []
  const explicitInstallDir = nonEmptyValue(env.CODEX_INSTALL_DIR)
  if (explicitInstallDir !== undefined) candidates.push(win32.join(explicitInstallDir, "codex.exe"))

  const localAppData = nonEmptyValue(env.LOCALAPPDATA) ?? nonEmptyValue(env.LocalAppData)
  if (localAppData !== undefined) {
    candidates.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"))
  }

  return dedupe(candidates)
}

function missingCodexInstallation(
  checkedPaths: readonly string[],
  hint: string,
  downloadedInstallerPath?: string,
): CodexInstallationDetection {
  if (downloadedInstallerPath !== undefined) {
    return { found: false, checkedPaths, hint, downloadedInstallerPath }
  }
  return { found: false, checkedPaths, hint }
}

function nonEmptyValue(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function dedupe(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    deduped.push(value)
  }
  return deduped
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
): Promise<CodexInstallationCommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      resolve({ success: error === null, stdout })
    })
  })
}
