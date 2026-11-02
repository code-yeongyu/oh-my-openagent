import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"

import type { HostGenerationView } from "../../lifecycle/host-session"
import type { HostSessionIdentity } from "../../state"
import { hostDaemonDir } from "./host-daemon-dir"

const GENERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * The endpoint's daemon state as senpi lays it out (`<daemonDir>/generations/<instanceId>/`,
 * `<daemonDir>/handover-parked/<sha256(sessionPath)[:16]>.json`), read-only. Anything but a definite
 * "absent" reads as present, so an unreadable directory never proves a session ended.
 */
export function createHostGenerationView(agentDir: string): HostGenerationView {
  return {
    generationPresent: async (hostSession) => {
      if (!GENERATION_ID.test(hostSession.instance_id) || hostSession.instance_id.includes("..")) return true
      return present(join(hostDaemonDir(agentDir, hostSession.socket), "generations", hostSession.instance_id))
    },
    parkedEntryPresent: async (hostSession) => {
      const dir = join(hostDaemonDir(agentDir, hostSession.socket), "handover-parked")
      for (const sessionPath of sessionPathSpellings(hostSession)) {
        if (await present(join(dir, `${createHash("sha256").update(sessionPath, "utf8").digest("hex").slice(0, 16)}.json`))) return true
      }
      return false
    },
  }
}

async function present(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT"
  }
}

// The host keys a parked entry by the path it opened the session with, which may be the canonical one.
function sessionPathSpellings(hostSession: HostSessionIdentity): readonly string[] {
  try {
    const canonical = realpathSync(hostSession.session_path)
    return canonical === hostSession.session_path ? [canonical] : [hostSession.session_path, canonical]
  } catch {
    return [hostSession.session_path]
  }
}
