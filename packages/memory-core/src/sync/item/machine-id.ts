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
    const out = await run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
    return /"IOPlatformUUID" = "([^"]+)"/.exec(out ?? "")?.[1] ?? null
  }
  if (process.platform === "win32") {
    const out = await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
    return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out ?? "")?.[1] ?? null
  }
  return null
}

function run(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      resolve(error === null ? stdout : null)
    })
  })
}
