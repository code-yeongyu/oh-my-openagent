import { execFile } from "node:child_process"
import { readFile } from "../fs/resilient"
import { readDarwinProcessStartSeconds, readWin32ProcessCreationFiletime } from "./process-start-time"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export type ExecFileText = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string | null>

async function execFileText(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return await new Promise((resolve) => {
    // powershell.exe is a console-subsystem binary, and under a Node runtime (no bun:ffi, so the
    // kernel32 fast path below can never answer) this fallback runs on EVERY pid probe. Without
    // windowsHide each probe flashes a console Windows foregrounds, stealing focus (#8501).
    execFile(command, args, { encoding: "utf8", timeout: 2_000, windowsHide: true, env }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      const value = stdout.trim()
      resolve(value.length > 0 ? value : null)
    })
  })
}

async function readLinuxStartIdentity(pid: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    const commandEnd = stat.lastIndexOf(")")
    if (commandEnd < 0) return null
    const fieldsAfterCommand = stat
      .slice(commandEnd + 2)
      .trim()
      .split(/\s+/)
    const startTicks = fieldsAfterCommand[19]
    return startTicks === undefined ? null : `linux-proc-start-ticks:${startTicks}`
  } catch {
    return null
  }
}

async function readWin32StartIdentity(pid: number): Promise<string | null> {
  if (getPidLiveness(pid) === "dead") return null
  const creationFiletime = await readWin32ProcessCreationFiletime(pid)
  if (creationFiletime !== null) return `win32-creation-filetime:${creationFiletime}`
  // Only when kernel32 is unreachable through bun:ffi: PowerShell can resolve CreationDate for any
  // visible process, at the cost of one process spawn under a 2 s budget per probe.
  const value = await execFileText("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`,
  ])
  return value === null ? null : `win32-creation-date:${value}`
}

/**
 * The image name in `tasklist /FO CSV /NH` output, which is `"bun.exe","1234","Console","1","12,345 K"` for a match and
 * an INFO line otherwise. Only the first row counts, and only when it names the pid that was asked for.
 */
export function tasklistImageName(output: string | null, pid: number): string | null {
  const match = output === null ? null : /^"([^"]+)","(\d+)"/.exec(output)
  return match === null || Number(match[2]) !== pid ? null : match[1]
}

async function readWin32ImageName(pid: number): Promise<string | null> {
  return tasklistImageName(await execFileText("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]), pid)
}

type ReadProcessStartIdentity = (pid: number) => Promise<string | null>

export function createProcessStartIdentityReader(
  read: ReadProcessStartIdentity,
  ownPid: number,
): ReadProcessStartIdentity {
  // Our own pid cannot be reused while this module is alive. Other owners must always
  // be re-probed: caching them would hide process exit or PID reuse from stale-lock recovery.
  let ownIdentity: Promise<string | null> | undefined
  return (pid) => {
    if (pid !== ownPid) return read(pid)
    ownIdentity ??= read(pid).then(
      (identity) => {
        if (identity === null) ownIdentity = undefined
        return identity
      },
      (error: unknown) => {
        ownIdentity = undefined
        throw error
      },
    )
    return ownIdentity
  }
}

export const getProcessStartIdentity = createProcessStartIdentityReader(readProcessStartIdentity, process.pid)

async function readProcessStartIdentity(pid: number): Promise<string | null> {
  if (process.platform === "linux") return await readLinuxStartIdentity(pid)
  if (process.platform === "darwin" || process.platform === "freebsd") {
    if (getPidLiveness(pid) === "dead") return null
    const startSeconds = await readDarwinProcessStartSeconds(pid)
    if (startSeconds !== null) return `proc-start-epoch:${startSeconds}`
    return await readPsLstartIdentity(pid)
  }
  if (process.platform === "win32") return await readWin32StartIdentity(pid)
  return null
}

/**
 * The darwin/freebsd fallback when `bun:ffi` cannot read the start time. `ps -o lstart=` renders in the reader's
 * timezone and locale, so it runs under UTC and the C locale, and every reader sees the same bytes for one process
 * (#12108). The scheme is `ps-lstart-utc:`; a record an older reader wrote in local time (`ps-lstart:`) is compared
 * with it by `legacyPsLstartConflict`.
 */
export async function readPsLstartIdentity(pid: number, exec: ExecFileText = execFileText): Promise<string | null> {
  const env = { ...process.env, TZ: "UTC", LC_ALL: "C", LANG: "C" }
  const value = await exec("/bin/ps", ["-o", "lstart=", "-p", String(pid)], env)
  return value === null ? null : `ps-lstart-utc:${value.replace(/\s+/g, " ")}`
}

/**
 * The basename of a live process's argv[0], or null when the process is gone or the platform cannot say. Lets a
 * caller name a lock holder by what it runs; Linux reads /proc, macOS and FreeBSD ask ps, Windows asks tasklist for the
 * image name (Windows keeps no argv[0] another process can read).
 */
export async function getProcessCommandName(pid: number): Promise<string | null> {
  let argv0: string | undefined
  if (process.platform === "linux") {
    try {
      argv0 = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0", 1)[0]
    } catch {
      return null
    }
  } else if (process.platform === "darwin" || process.platform === "freebsd") {
    argv0 = (await execFileText("/bin/ps", ["-o", "args=", "-p", String(pid)]))?.split(/\s+/, 1)[0]
  } else if (process.platform === "win32") {
    return readWin32ImageName(pid)
  }
  const name = argv0?.slice(argv0.lastIndexOf("/") + 1)
  return name === undefined || name === "" ? null : name
}

function identityScheme(identity: string): string | null {
  const separator = identity.indexOf(":")
  return separator <= 0 ? null : identity.slice(0, separator)
}

const LSTART_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LSTART_C_RENDERING = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/

// The wall-clock time a C-locale `ps -o lstart=` rendering names, read as if it were UTC, in ms; null when the text is
// not that rendering (another locale, or garbled).
function lstartWallClockMs(rendering: string): number | null {
  const match = LSTART_C_RENDERING.exec(rendering)
  if (match === null) return null
  const [, month, day, hours, minutes, seconds, year] = match
  const monthIndex = LSTART_MONTHS.indexOf(month ?? "")
  if (monthIndex < 0) return null
  return Date.UTC(Number(year), monthIndex, Number(day), Number(hours), Number(minutes), Number(seconds))
}

// A POSIX `TZ` names any offset up to 24:59:59 either way, to the second (`TZ='XYZ-15'`, `TZ='<X>-5:30:20'`), not only
// the [UTC-12, UTC+14] quarter-hour offsets of the tz database (#15383).
const MAX_POSIX_ZONE_OFFSET_MS = (25 * 3_600 - 1) * 1_000

/**
 * The upgrade window (#12108 -> `ps-lstart-utc:`): a lock an older reader recorded as `ps-lstart:` holds the owner's start
 * as local wall time in a zone nobody recorded. It proves the pid was reused only when no POSIX zone offset can map that
 * wall time onto the live process's UTC start; any nearer gap may be a live owner's own zone, so it keeps the holder. A
 * record that cannot be read (a non-C locale) proves nothing.
 */
function legacyPsLstartConflict(recorded: string, actual: string): boolean {
  const recordedWall = lstartWallClockMs(recorded.slice("ps-lstart:".length))
  const actualUtc = lstartWallClockMs(actual.slice("ps-lstart-utc:".length))
  if (recordedWall === null || actualUtc === null) return false
  return Math.abs(recordedWall - actualUtc) > MAX_POSIX_ZONE_OFFSET_MS
}

// `ps -o lstart=` once rendered local time (`ps-lstart:`), so the same pid yielded different bytes to two processes
// that disagreed about the timezone, and a mismatch is what proves an owner dead. Byte comparison across schemes
// would therefore let a live owner's lock be stolen during an upgrade: a legacy `ps-lstart:` record is judged against a
// `ps-lstart-utc:` reading by the zone bound above, and any other pair of different schemes is no conflict.
export function startIdentitiesConflict(recorded: string, actual: string): boolean {
  const recordedScheme = identityScheme(recorded)
  const actualScheme = identityScheme(actual)
  if (recordedScheme === "ps-lstart" && actualScheme === "ps-lstart-utc")
    return legacyPsLstartConflict(recorded, actual)
  if (recordedScheme === null || recordedScheme !== actualScheme) return false
  return recorded !== actual
}

/**
 * Whether a live pid's recorded start proves the pid was reused, for the run and launcher liveness callers: the lock
 * path's rule (`startIdentitiesConflict`, which also judges a legacy `ps-lstart:` record by the zone bound, #15362), plus
 * the meaning scheme-less records were written with: two values from before schemes existed compare by their bytes.
 */
export function startIdentitiesProveReuse(recorded: string, actual: string): boolean {
  if (identityScheme(recorded) === null && identityScheme(actual) === null) return recorded !== actual
  return startIdentitiesConflict(recorded, actual)
}

export type ProcessLiveness = "alive" | "dead" | "unknown"

export function getPidLiveness(pid: number): ProcessLiveness {
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    const code = errorCode(error)
    if (code === "ESRCH") return "dead"
    if (code === "EPERM") return "alive"
    return "unknown"
  }
}
