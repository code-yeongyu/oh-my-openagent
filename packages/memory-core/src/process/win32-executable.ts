import { win32 } from "node:path"

import { statSync } from "../fs/resilient"

// #12146: on Windows a bare-name spawn searches the working directory before PATH (Bun, libuv and
// CreateProcessW alike), so a git.exe/.cmd/.bat/.com - or a reg.exe or powershell.exe - placed in the
// memory repository or the user's project would run instead of the real tool. Every memory spawn on
// win32 therefore resolves its executable here to an absolute path first: only fully qualified PATH
// directories are searched (a relative, drive-relative or rooted entry is itself a lookup relative to
// the working directory), in Bun's extension order, and the working directory is never read.

export type IsFile = (path: string) => boolean

// Bun's which_win order (src/which/lib.rs at bun-v1.4.4): .exe/.cmd/.bat over every directory, then a
// last .com pass, so a PATH result is byte-identical to the one the direct spawn picked before #12146.
const EXTENSIONS = [".exe", ".cmd", ".bat"] as const
const COM_EXTENSION = [".com"] as const
const SPELLED_EXTENSION = /\.(?:exe|cmd|bat|com)$/i

const WINDOWS_GIT_CANDIDATES = [
  ["ProgramFiles", ["Git", "cmd", "git.exe"]],
  ["ProgramW6432", ["Git", "cmd", "git.exe"]],
  ["ProgramFiles(x86)", ["Git", "cmd", "git.exe"]],
  ["LOCALAPPDATA", ["Programs", "Git", "cmd", "git.exe"]],
] as const

const reportedSkips = new Set<string>()

function existingFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const [key, value] of Object.entries(environment)) {
    if (key.toLowerCase() !== name.toLowerCase() || value === undefined) continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

export function isDriveQualified(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

// `X:\...` or a UNC `\\server\share\...`. Device paths (`\\?\`, `\\.\`) are not accepted.
function isFullyQualified(path: string): boolean {
  return isDriveQualified(path) || /^[\\/]{2}[^\\/?.][^\\/]*[\\/][^\\/]+/.test(path)
}

// Splits PATH the way libuv's search_path does (src/win/process.c): a segment that starts with a quote
// runs to its closing quote before the next `;` ends it, and one leading and one trailing quote are
// stripped. Empty segments are dropped.
function pathSegments(value: string): string[] {
  const segments: string[] = []
  let start = 0
  while (start <= value.length) {
    let scan = start
    const quote = value[start]
    if (quote === "\"" || quote === "'") {
      const closing = value.indexOf(quote, start + 1)
      scan = closing === -1 ? value.length : closing
    }
    const separator = value.indexOf(";", scan)
    const end = separator === -1 ? value.length : separator
    let segment = value.slice(start, end)
    if (segment.startsWith("\"") || segment.startsWith("'")) segment = segment.slice(1)
    if (segment.endsWith("\"") || segment.endsWith("'")) segment = segment.slice(0, -1)
    if (segment.length > 0) segments.push(segment)
    start = end + 1
  }
  return segments
}

function reportSkippedEntry(entry: string): void {
  if (reportedSkips.has(entry)) return
  reportedSkips.add(entry)
  process.stderr.write(`omo: skipped PATH entry ${JSON.stringify(entry)} when locating a program: only fully qualified directories are searched on Windows\n`)
}

function qualifiedPathDirectories(environment: NodeJS.ProcessEnv): string[] {
  const directories: string[] = []
  for (const entry of pathSegments(environmentValue(environment, "PATH") ?? "")) {
    if (isFullyQualified(entry)) directories.push(entry)
    else reportSkippedEntry(entry)
  }
  return directories
}

function firstInDirectories(directories: readonly string[], name: string, extensions: readonly string[], isFile: IsFile): string | undefined {
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = win32.join(directory, `${name}${extension}`)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

/** Absolute path of `name` from fully qualified PATH directories only, or undefined. Never reads the cwd. */
export function resolveWin32Executable(name: string, environment: NodeJS.ProcessEnv, isFile: IsFile = existingFile): string | undefined {
  if (/[\\/]/.test(name)) return isFullyQualified(name) && isFile(name) ? name : undefined
  const directories = qualifiedPathDirectories(environment)
  if (SPELLED_EXTENSION.test(name)) return firstInDirectories(directories, name, [""], isFile)
  return firstInDirectories(directories, name, EXTENSIONS, isFile) ?? firstInDirectories(directories, name, COM_EXTENSION, isFile)
}

function windowsGitInstallCandidates(environment: NodeJS.ProcessEnv): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const [environmentName, pathParts] of WINDOWS_GIT_CANDIDATES) {
    const root = environmentValue(environment, environmentName)
    if (root === undefined || !isDriveQualified(root)) continue
    const candidate = win32.join(root, ...pathParts)
    const normalizedCandidate = win32.normalize(candidate).toLowerCase()
    if (seen.has(normalizedCandidate)) continue
    seen.add(normalizedCandidate)
    candidates.push(candidate)
  }
  return candidates
}

/** git from PATH, then the Git for Windows install roots; undefined when neither has it. */
export function resolveWin32Git(environment: NodeJS.ProcessEnv, isFile: IsFile = existingFile): string | undefined {
  // #12146 open question 2: an absolute-path override, if approved, is consulted here before PATH.
  return resolveWin32Executable("git", environment, isFile) ?? windowsGitInstallCandidates(environment).find((candidate) => isFile(candidate))
}
