import { existsSync, readFileSync } from "node:fs"

export type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string }

export function run(command: string, args: readonly string[], timeoutMs = 60_000): Ran {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutMs })
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  }
}

export type Json = Readonly<Record<string, unknown>>

function parseObject(text: string): Json | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : null
}

export function helper(binary: string, args: readonly string[], timeoutMs = 60_000): Json {
  const ran = run(binary, args, timeoutMs)
  return parseObject(ran.stdout) ?? { helperError: `exit ${ran.code}: ${ran.stderr || ran.stdout || "no output"}`.slice(0, 300) }
}

export function short(value: unknown): string {
  return JSON.stringify(value).slice(0, 400)
}

export const SYSTEM_TCC_DB = "/Library/Application Support/com.apple.TCC/TCC.db"
export const PROBE_SERVICES = [
  "kTCCServiceAccessibility",
  "kTCCServicePostEvent",
  "kTCCServiceListenEvent",
  "kTCCServiceScreenCapture",
] as const

const serviceList = PROBE_SERVICES.map((service) => `'${service}'`).join(",")

export function grantedRows(db: string, sudo: boolean): Ran {
  const sql = `SELECT service, client, client_type, auth_reason FROM access WHERE service IN (${serviceList}) AND auth_value = 2 ORDER BY service, client;`
  return sudo ? run("/usr/bin/sudo", ["/usr/bin/sqlite3", db, sql]) : run("/usr/bin/sqlite3", [db, sql])
}

function sqlString(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

export function insertProbeRows(client: string, csreqHex: string | null): Ran {
  const now = Math.floor(Date.now() / 1000)
  const csreq = csreqHex === null ? "NULL" : `X'${csreqHex}'`
  const statements = PROBE_SERVICES.map(
    (service) =>
      `INSERT OR REPLACE INTO access (service, client, client_type, auth_value, auth_reason, auth_version, csreq, flags, last_modified) VALUES (${sqlString(service)}, ${sqlString(client)}, 1, 2, 4, 1, ${csreq}, 0, ${now});`,
  )
  return run("/usr/bin/sudo", ["/usr/bin/sqlite3", SYSTEM_TCC_DB, statements.join(" ")])
}

export function deleteProbeRows(client: string): Ran {
  return run("/usr/bin/sudo", [
    "/usr/bin/sqlite3",
    SYSTEM_TCC_DB,
    `DELETE FROM access WHERE client = ${sqlString(client)} AND service IN (${serviceList}); SELECT changes();`,
  ])
}

export function countProbeRows(client: string): number {
  const ran = run("/usr/bin/sudo", [
    "/usr/bin/sqlite3",
    SYSTEM_TCC_DB,
    `SELECT count(*) FROM access WHERE client = ${sqlString(client)};`,
  ])
  return ran.code === 0 ? Number(ran.stdout) : -1
}

export function restartTccd(): string {
  const uid = run("/usr/bin/id", ["-u"]).stdout
  const system = run("/usr/bin/sudo", ["/bin/launchctl", "kickstart", "-k", "system/com.apple.tccd.system"])
  const user = run("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/com.apple.tccd`])
  return `tccd restart system=${system.code} user=${user.code}`
}

export function designatedRequirementHex(binary: string, scratch: string): string | null {
  const shown = run("/usr/bin/codesign", ["-d", "-r-", binary])
  const requirement = `${shown.stdout}\n${shown.stderr}`.match(/designated => (.+)/)?.[1]
  if (requirement === undefined) return null
  const blob = `${scratch}/csreq.bin`
  if (run("/usr/bin/csreq", ["-r=" + requirement, "-b", blob]).code !== 0 || !existsSync(blob)) return null
  return readFileSync(blob).toString("hex")
}

export const DIALOG_PROCESSES = [
  "UserNotificationCenter",
  "universalAccessAuthWarn",
  "SecurityAgent",
  "CoreServicesUIAgent",
  "System Settings",
] as const

export function dialogProcesses(): string[] {
  const listed = run("/bin/ps", ["-axo", "comm="]).stdout.split("\n")
  return listed.map((line) => line.split("/").at(-1) ?? "").filter((name) => (DIALOG_PROCESSES as readonly string[]).includes(name))
}

export function pidOf(name: string): number | null {
  const ran = run("/usr/bin/pgrep", ["-x", name])
  const first = Number(ran.stdout.split("\n")[0])
  return ran.code === 0 && Number.isInteger(first) && first > 0 ? first : null
}

export async function until<T>(read: () => T, accept: (value: T) => boolean, deadlineMs: number): Promise<T> {
  const started = Date.now()
  let value = read()
  while (!accept(value) && Date.now() - started < deadlineMs) {
    await Bun.sleep(250)
    value = read()
  }
  return value
}
