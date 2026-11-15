import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { runtimeHome } from "./bin/lib/agent-dir.js"

// omo#13602 (Q: remote sessions on by default, turned off with disable): `omo remote disable` records that this user
// turned remote sessions off, so the bootstrap every omo start runs never sets them up again, even when the device
// service's own switch comes back on (a reinstall or a forget resets it); `omo remote enable` clears the record. It lives
// in omo's config root, never in the device service's state dir, which its installer owns.

export type RemoteOptOut = {
  readonly read: () => boolean
  readonly record: () => void
  readonly clear: () => void
}

const remoteOptOutPath = (home: string = runtimeHome()): string => join(home, ".omo", "remote-sessions.json")

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function remoteOptOut(path: string = remoteOptOutPath()): RemoteOptOut {
  return {
    // A record that does not parse still says the user turned remote sessions off: honoring it is the safe reading.
    read: () => {
      if (!existsSync(path)) return false
      try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"))
        return !isRecord(value) || value["remote_sessions"] !== "on"
      } catch {
        return true
      }
    },
    record: () => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify({ remote_sessions: "off", since: new Date().toISOString() })}\n`, {
        mode: 0o600,
      })
    },
    clear: () => rmSync(path, { force: true }),
  }
}
