import { execFileSync } from "node:child_process"

// Bun reports a file Windows will not let it move or replace as EPERM/EBUSY (NtSetInformationFile).
// EACCES is left out: on Windows it is a permission problem (a protected prefix), which no retry fixes.
const LOCK_PATTERN = /\b(EPERM|EBUSY)\b|NtSetInformationFile|being used by another process/i
// A bare EPERM is also npm's spelling of a real permission failure (mkdir under a protected prefix), so it
// only counts as a lock when the failing call moved or deleted an existing file.
const CERTAIN_LOCK = /NtSetInformationFile|\bEBUSY\b|being used by another process/i
const MOVE_OR_DELETE_SYSCALL = /\bsyscall:? '?(rename|unlink|rmdir)\b|\b(rename|unlink|rmdir) '/i
const NPM_PATH_LINE = /^npm (?:error|ERR!) path (.+)$/

/** Backoff between attempts while the file is held; the lock is usually a short antivirus scan. */
export const LOCK_RETRY_DELAYS_MS = [2000, 5000]

/** @param {string | undefined} stderr */
export function isLockFailure(stderr) {
  if (typeof stderr !== "string") return false
  if (CERTAIN_LOCK.test(stderr)) return true
  return /\bEPERM\b/.test(stderr) && MOVE_OR_DELETE_SYSCALL.test(stderr)
}

/**
 * The quoted package or path Bun names on the failing line (or the line before it), if any.
 * @param {string | undefined} stderr
 */
export function heldTarget(stderr) {
  if (typeof stderr !== "string") return undefined
  const lines = stderr.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!LOCK_PATTERN.test(lines[index])) continue
    for (const line of [lines[index], lines[index - 1] ?? ""]) {
      const quoted = /"([^"]+)"|'([^']+)'/.exec(line)
      if (quoted) return quoted[1] ?? quoted[2]
    }
  }
  // npm names the file on its own unquoted `npm error path <path>` line.
  for (const line of lines) {
    const npmPath = NPM_PATH_LINE.exec(line.trim())
    if (npmPath) return npmPath[1].trim()
  }
  return undefined
}

/**
 * @typedef {{ pid: number, name: string, commandLine?: string | null, executablePath?: string | null }} ProcessEntry
 */

function normalizePath(path) {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()
}

// The packages omo runs processes from: the launcher and its pinned senpi engine.
const OMO_PACKAGES = ["omo-ai", "@code-yeongyu"]

/**
 * Processes running from, or started with a path inside, omo's own packages or the held package in the
 * global `node_modules`, minus this update's own processes. Other global CLIs share that directory but
 * cannot hold these files, so they are not reported; anything outside it (an antivirus scan) is invisible.
 * @param {string} installDir the global `node_modules` omo is installed in
 * @param {readonly ProcessEntry[]} processes
 * @param {readonly number[]} excludePids
 * @param {string | undefined} held the package or path the manager reported as held
 */
export function findHolders(installDir, processes, excludePids, held = undefined) {
  const root = normalizePath(installDir)
  const needles = OMO_PACKAGES.map((name) => `${root}\\${normalizePath(name)}\\`)
  let heldPath
  if (held !== undefined) {
    const target = normalizePath(held)
    heldPath = /^[a-z]:\\|^\\\\/.test(target) ? target : `${root}\\${target}`
    needles.push(`${heldPath}\\`)
  }
  return processes.filter((entry) => {
    if (excludePids.includes(entry.pid)) return false
    // npm can name the held file itself; the process running exactly that executable holds it.
    if (heldPath !== undefined && typeof entry.executablePath === "string" && normalizePath(entry.executablePath) === heldPath) return true
    return [entry.executablePath, entry.commandLine].some((value) => {
      if (typeof value !== "string") return false
      const path = normalizePath(value)
      return needles.some((needle) => path.includes(needle))
    })
  })
}

/**
 * Every process on this Windows machine with its path and command line, through CIM. Fail-open: a host
 * where the query cannot run reports no holders rather than failing the update report.
 * @returns {ProcessEntry[]}
 */
export function listWindowsProcesses() {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    )
    const parsed = JSON.parse(output)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map((row) => ({
      pid: Number(row.ProcessId),
      name: String(row.Name ?? ""),
      executablePath: row.ExecutablePath ?? null,
      commandLine: row.CommandLine ?? null,
    }))
  } catch {
    return []
  }
}
