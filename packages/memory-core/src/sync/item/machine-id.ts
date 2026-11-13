// Device identity for the peer (reviews r4 MEDIUM, r5 M3): the peer file stores a hash of the
// OS machine id AND the canonical state-dir path, so a state dir copied to another machine or
// to another path on the same machine (a second profile, a cloned image) mints a new peer,
// while a backup restored to the same path on the same machine keeps it.
// Sources: /etc/machine-id (Linux), IOPlatformUUID (macOS), MachineGuid (Windows). Without one,
// a fixed marker stands in, so the path binding still applies and nothing changes with the
// network (the hostname fallback churned the peer, review r5 L2).

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"

import { readFile } from "../../fs/resilient"

export function deviceFingerprint(machineId: string, stateDir: string): string {
  return createHash("sha256").update(`omo-item-device:${machineId}\0${stateDir}`).digest("hex")
}

let cached: Promise<string> | null = null

export function readMachineId(): Promise<string> {
  cached ??= platformMachineId().then((id) => id ?? "no-platform-machine-id")
  return cached
}

async function platformMachineId(): Promise<string | null> {
  if (process.platform === "linux") {
    for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      const text = await readFile(path, "utf8").then(
        (value) => value.trim(),
        () => "",
      )
      if (text !== "") return text
    }
    return null
  }
  if (process.platform === "darwin") {
    return darwinPlatformUuid()
  }
  if (process.platform === "win32") {
    return windowsMachineGuid()
  }
  return null
}

async function darwinPlatformUuid(): Promise<string | null> {
  const out = await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
  return /"IOPlatformUUID" = "([^"]+)"/.exec(out ?? "")?.[1] ?? null
}

async function windowsMachineGuid(): Promise<string | null> {
  const out = await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
  return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out ?? "")?.[1] ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LINUX_MACHINE_ID = /^[0-9a-f]{32}$/

/**
 * The validated, normalized hardware id of one platform's raw probe text (#6503 final contract section 2): a lowercase
 * canonical UUID for macOS IOPlatformUUID and Windows MachineGuid, lowercase 32 hex digits for a Linux machine-id.
 * Empty, malformed and all-zero ids are null: never a shared sentinel, a hostname or an install path.
 */
export function normalizeHardwareId(platform: NodeJS.Platform, raw: string | null): string | null {
  const text = (raw ?? "").trim().toLowerCase()
  const id = platform === "win32" && text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text
  const valid =
    platform === "linux" ? LINUX_MACHINE_ID.test(id) : (platform === "darwin" || platform === "win32") && UUID.test(id)
  return valid && /[1-9a-f]/.test(id) ? id : null
}

type ReadText = (path: string, encoding: "utf8") => Promise<string>

/** A failed read is null so the next source can run. A successful read, even an empty one, is kept. */
async function readTextOrNull(path: string, read: ReadText): Promise<string | null> {
  return read(path, "utf8").then(
    (value) => value,
    () => null,
  )
}

/**
 * This machine's validated hardware id, or null when the platform has none that validates. Linux tries
 * /etc/machine-id, then /var/lib/dbus/machine-id when that read fails for any reason (missing or unreadable),
 * then no id. Unlike `readMachineId`, there is no fallback marker.
 */
export async function readHardwareId(
  platform: NodeJS.Platform = process.platform,
  read: ReadText = readFile,
): Promise<string | null> {
  if (platform === "linux") {
    const primary = await readTextOrNull("/etc/machine-id", read)
    const raw = primary ?? (await readTextOrNull("/var/lib/dbus/machine-id", read)) ?? ""
    return normalizeHardwareId(platform, raw)
  }
  if (platform === "darwin") return normalizeHardwareId(platform, await darwinPlatformUuid())
  if (platform === "win32") return normalizeHardwareId(platform, await windowsMachineGuid())
  return null
}

function run(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      resolve(error === null ? stdout : null)
    })
  })
}
