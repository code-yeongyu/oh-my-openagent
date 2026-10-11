import { statSync } from "node:fs"
import path from "node:path"
import type { ShellType } from "./shell-env"

/**
 * The shell OpenCode's bash tool will actually run, mirrored from OpenCode's
 * `Shell.acceptable(cfg.shell)` (packages/core/src/shell.ts, stable since 1.4.0;
 * `cfg.shell` is honored from 1.14.27). Command prefixes must use this shell's
 * syntax: inferring it from ComSpec picks cmd on machines where OpenCode runs
 * PowerShell (#9733).
 *
 * Order: the configured `shell`, else `$SHELL`, when it is not fish/nu and
 * resolves to a file; otherwise on Windows the first of pwsh, powershell,
 * Git Bash, then COMSPEC (or cmd.exe); elsewhere /bin/zsh on macOS, then bash,
 * then /bin/sh.
 */
export interface OpenCodeShellHost {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly isFile: (file: string) => boolean
}

const DENIED_SHELLS = new Set(["fish", "nu"])
const DEFAULT_WINDOWS_PATHEXT = ".EXE;.CMD;.BAT;.COM"

function defaultHost(): OpenCodeShellHost {
  return {
    platform: process.platform,
    env: process.env,
    isFile: (file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true,
  }
}

function envValue(host: OpenCodeShellHost, key: string): string | undefined {
  if (host.platform !== "win32") return host.env[key]
  const name = Object.keys(host.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name === undefined ? undefined : host.env[name]
}

function windowsPath(host: OpenCodeShellHost, file: string): string {
  if (host.platform !== "win32") return file
  return file
    .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive: string) => `${drive.toUpperCase()}:/`)
    .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive: string) => `${drive.toUpperCase()}:/`)
    .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive: string) => `${drive.toUpperCase()}:/`)
    .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive: string) => `${drive.toUpperCase()}:/`)
}

export function openCodeShellName(file: string, host: OpenCodeShellHost = defaultHost()): string {
  if (host.platform === "win32") return path.win32.parse(windowsPath(host, file)).name.toLowerCase()
  return path.posix.basename(file).toLowerCase()
}

function which(host: OpenCodeShellHost, command: string): string | undefined {
  const win = host.platform === "win32"
  const pathApi = win ? path.win32 : path.posix
  if (command.includes("/") || (win && command.includes("\\"))) {
    return host.isFile(command) ? command : undefined
  }
  const extensions = win ? (envValue(host, "PATHEXT") ?? DEFAULT_WINDOWS_PATHEXT).split(";").filter(Boolean) : []
  const names = win ? [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)] : [command]
  for (const directory of (envValue(host, "PATH") ?? "").split(win ? ";" : ":")) {
    if (!directory) continue
    for (const name of names) {
      const candidate = pathApi.join(directory, name)
      if (host.isFile(candidate)) return candidate
    }
  }
  return undefined
}

function gitBash(host: OpenCodeShellHost): string | undefined {
  if (host.platform !== "win32") return undefined
  const configured = envValue(host, "OPENCODE_GIT_BASH_PATH")
  if (configured) return configured
  const git = which(host, "git")
  if (!git) return undefined
  const file = path.win32.join(git, "..", "..", "bin", "bash.exe")
  return host.isFile(file) ? file : undefined
}

function full(host: OpenCodeShellHost, file: string): string {
  if (host.platform !== "win32") return file
  const shell = windowsPath(host, file)
  if (path.win32.dirname(shell) !== ".") {
    if (shell.startsWith("/") && openCodeShellName(shell, host) === "bash") return gitBash(host) ?? shell
    return shell
  }
  if (openCodeShellName(shell, host) === "bash") return gitBash(host) ?? which(host, shell) ?? shell
  return which(host, shell) ?? shell
}

function resolveShell(host: OpenCodeShellHost, file: string): string | undefined {
  const shell = full(host, file)
  const rooted = host.platform === "win32" ? path.win32.isAbsolute(windowsPath(host, shell)) : path.posix.isAbsolute(shell)
  if (rooted) return host.isFile(shell) ? shell : undefined
  return which(host, shell)
}

function platformDefault(host: OpenCodeShellHost): string {
  if (host.platform === "win32") {
    const candidates = [which(host, "pwsh"), which(host, "powershell"), gitBash(host), envValue(host, "COMSPEC") || "cmd.exe"]
    const first = candidates.find((candidate): candidate is string => Boolean(candidate))
    return full(host, first ?? "cmd.exe")
  }
  if (host.platform === "darwin") return "/bin/zsh"
  return which(host, "bash") ?? "/bin/sh"
}

export function resolveOpenCodeShell(configShell: string | undefined, host: OpenCodeShellHost = defaultHost()): string {
  const candidate = configShell || envValue(host, "SHELL")
  if (candidate && !DENIED_SHELLS.has(openCodeShellName(candidate, host))) {
    const shell = resolveShell(host, candidate)
    if (shell) return shell
  }
  return platformDefault(host)
}

export function shellTypeForOpenCodeShell(shellPath: string, host: OpenCodeShellHost = defaultHost()): ShellType {
  const name = openCodeShellName(shellPath, host)
  if (name === "pwsh" || name === "powershell") return "powershell"
  if (name === "cmd") return "cmd"
  if (name === "csh" || name === "tcsh") return "csh"
  return "unix"
}

export interface OpenCodeShellTypeResolver {
  setConfiguredShell(shell: unknown): void
  resolveShellType(): ShellType
}

export function createOpenCodeShellTypeResolver(host: () => OpenCodeShellHost = defaultHost): OpenCodeShellTypeResolver {
  let configuredShell: string | undefined
  let cached: ShellType | undefined
  return {
    setConfiguredShell(shell) {
      const next = typeof shell === "string" && shell.trim() !== "" ? shell : undefined
      if (next !== configuredShell) cached = undefined
      configuredShell = next
    },
    resolveShellType() {
      if (cached !== undefined) return cached
      const current = host()
      cached = shellTypeForOpenCodeShell(resolveOpenCodeShell(configuredShell, current), current)
      return cached
    },
  }
}

export const openCodeShellTypeResolver = createOpenCodeShellTypeResolver()
