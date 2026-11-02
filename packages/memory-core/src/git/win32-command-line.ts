import { win32 } from "node:path"

import { statSync } from "../fs/resilient"

// The helper creates git with the command line P supplies (design v4.2 section 6.1), so these two functions reproduce
// what libuv's uv_spawn does for a direct spawn today: quote_cmd_arg + make_program_args (src/win/process.c) for the
// command line, and search_path for the executable. Byte parity is pinned by row T12.

export function quoteWindowsArgument(argument: string): string {
  if (argument.length === 0) return '""'
  if (!/[ \t"]/.test(argument)) return argument
  if (!/["\\]/.test(argument)) return `"${argument}"`
  // libuv walks the argument backwards: a backslash run is doubled only when it reaches a quote (or the closing quote),
  // and every embedded quote gets one backslash. Both the walk and the final _wcsrev work on UTF-16 code units, so a
  // surrogate pair is reversed twice and comes out whole.
  const reversed: string[] = []
  let quoteHit = true
  for (let index = argument.length - 1; index >= 0; index -= 1) {
    const codeUnit = argument[index] ?? ""
    reversed.push(codeUnit)
    if (quoteHit && codeUnit === "\\") {
      reversed.push("\\")
    } else if (codeUnit === '"') {
      quoteHit = true
      reversed.push("\\")
    } else {
      quoteHit = false
    }
  }
  return `"${reversed.reverse().join("")}"`
}

export function windowsCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArgument).join(" ")
}

function isFile(path: string): boolean {
  try {
    return !statSync(path).isDirectory()
  } catch {
    return false
  }
}

// search_path_join_test: a relative directory is taken from the spawn's cwd, a drive-relative one from that drive.
function joinedCandidate(directory: string, name: string, cwd: string): string {
  if (/^[\\/]{2}/.test(directory) || /^[A-Za-z]:[\\/]/.test(directory)) return win32.join(directory, name)
  if (/^[\\/]/.test(directory)) return win32.join(cwd.slice(0, 2), directory, name)
  if (/^[A-Za-z]:/.test(directory)) {
    const sameDrive = cwd.slice(0, 2).toLowerCase() === directory.slice(0, 2).toLowerCase()
    return sameDrive ? win32.join(cwd, directory.slice(2), name) : win32.join(directory, name)
  }
  return win32.join(cwd, directory, name)
}

// path_search_walk_ext: the name as given when it has an extension, then with .com, then with .exe.
function walkExtensions(directory: string, name: string, cwd: string, hasExtension: boolean): string | null {
  const candidates = [...(hasExtension ? [name] : []), `${name}.com`, `${name}.exe`]
  for (const candidate of candidates) {
    const path = joinedCandidate(directory, candidate, cwd)
    if (isFile(path)) return path
  }
  return null
}

function pathEntry(environment: NodeJS.ProcessEnv): string {
  for (const [key, value] of Object.entries(environment)) if (key.toUpperCase() === "PATH" && value !== undefined) return value
  return ""
}

export function searchWindowsExecutable(file: string, cwd: string, environment: NodeJS.ProcessEnv): string | null {
  if (file.length === 0 || file === ".") return null
  const nameStart = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/"), file.lastIndexOf(":")) + 1
  const name = file.slice(nameStart)
  const dot = name.indexOf(".")
  const hasExtension = dot >= 0 && dot < name.length - 1
  if (nameStart > 0) return walkExtensions(file.slice(0, nameStart), name, cwd, hasExtension)
  // NeedCurrentDirectoryForExePathW reads this process's own environment, not the child's.
  if (process.env.NoDefaultCurrentDirectoryInExePath === undefined) {
    const inCwd = walkExtensions("", file, cwd, hasExtension)
    if (inCwd !== null) return inCwd
  }
  for (const rawDirectory of pathEntry(environment).split(";")) {
    const directory = rawDirectory.replace(/^["']/, "").replace(/["']$/, "")
    if (directory.length === 0) continue
    const found = walkExtensions(directory, file, cwd, hasExtension)
    if (found !== null) return found
  }
  return null
}
