import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"

// Shared by the Linux and macOS cold-wake install tests (omo#13594): temp homes, the session host launch, and the
// `omo daemon` answers both platforms' fakes give.

const dirs: string[] = []

/** A temp home removed by `removeTempHomes`, which each test file runs after every test. */
export const tempHome = (prefix: string): string => {
  const home = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(home)
  return home
}

export const removeTempHomes = (): void => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export const LAUNCH = SessionHostLaunch.from({ omoBin: "/opt/omo", execPath: "/opt/omo", agentDir: "/h/.omo/agent" })

export const ok = (output = "") => ({ exitCode: 0, output })

export const OMO = "/usr/bin/env OMO_CODING_AGENT_DIR=/h/.omo/agent /opt/omo daemon"

/** `omo daemon status/stop` for the agent dir: one operator host, launched with or without the cold-start pin. */
export function fakeOmoHost(pinned: boolean) {
  const state = { running: true, pinned }
  const answer = (argv: readonly string[]) => {
    if (argv.includes("status")) {
      const envKeys = ["HOME", "OMO_AGENT_DIR", ...(state.pinned ? ["SENPI_RPC_HOST_COLD_START"] : [])]
      const endpoint = { socket: "/h/.omo/agent/rpc/rpc.sock", reachable: state.running, pid: 7, env_keys: envKeys }
      return ok(JSON.stringify({ endpoints: state.running ? [endpoint] : [] }))
    }
    if (argv.includes("stop")) state.running = false
    return ok(JSON.stringify({ action: "drained" }))
  }
  return { state, answer }
}

/** The runs that change something: no `systemctl show` reads and no `omo daemon status` probes. */
export const actions = (runs: readonly string[]) =>
  runs.filter((r) => !r.includes(" show ") && !r.endsWith(" status --json"))
