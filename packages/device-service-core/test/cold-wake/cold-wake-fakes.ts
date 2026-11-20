import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { ColdWakeHost } from "../../src/cold-wake/index.ts"
import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"
import type { RunCommand } from "../../src/install.ts"

// The fakes the cold-wake suites share: they keep the state systemd, launchd and plutil would keep, over a temp home.

const tempHomes: string[] = []

/** Removes every temp home a fake created; each suite runs it after each test. */
export function removeTempHomes(): void {
  for (const dir of tempHomes.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export const LAUNCH = SessionHostLaunch.from({ omoBin: "/opt/omo", execPath: "/opt/omo", agentDir: "/h/.omo/agent" })
export const UNIT_DIR = (home: string) => join(home, ".config", "systemd", "user")
export const DROP_IN = (home: string) => join(UNIT_DIR(home), "omo-relay-daemon.service.d", "50-omo-cold-wake.conf")

const ok = (output = "") => ({ exitCode: 0, output })

export const OMO = "/usr/bin/env OMO_CODING_AGENT_DIR=/h/.omo/agent /opt/omo daemon"

/** `omo daemon status/stop` for the agent dir: one operator host, launched with or without the cold-start pin. */
function fakeOmoHost(pinned: boolean) {
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

/** systemctl --user over the files under `home`: the effective Environment is the drop-in's, quoted the way systemd shows it. */
export function fakeSystemd(
  options: { readonly relayd?: boolean; readonly ownerTable?: string; readonly pinned?: boolean } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "cwl-"))
  tempHomes.push(home)
  const runs: string[] = []
  const unit = { enabled: false, active: false }
  const omo = fakeOmoHost(options.pinned ?? true)
  const run: RunCommand = async (argv) => {
    runs.push(argv.join(" "))
    if (argv[0] === "/usr/bin/env") return omo.answer(argv)
    const verb = argv[2]
    if (argv.includes("UnitFileState"))
      return ok(
        `UnitFileState=${unit.enabled ? "enabled" : "disabled"}\nActiveState=${unit.active ? "active" : "inactive"}\n`,
      )
    if (argv.at(-1) === "omo-session-host.service") {
      if (verb === "enable") unit.enabled = true
      if (verb === "start" || verb === "restart") unit.active = true
      if (verb === "disable") Object.assign(unit, { enabled: false, active: false })
      return ok()
    }
    if (argv.includes("LoadState")) return ok(options.relayd === false ? "not-found\n" : "loaded\n")
    if (argv.includes("Environment")) {
      const dropIn = existsSync(DROP_IN(home)) ? readFileSync(DROP_IN(home), "utf8") : ""
      const quoted = /^Environment=(".*")$/m.exec(dropIn)?.[1]
      const owner =
        options.ownerTable === undefined ? [] : [JSON.stringify(`OMO_RELAYD_SERVICES=${options.ownerTable}`)]
      return ok(`${["LANG=C", ...owner, ...(quoted === undefined ? [] : [quoted])].join(" ")}\n`)
    }
    return ok()
  }
  const host: ColdWakeHost = { platform: "linux", home, uid: 1000, run, pause: async () => {} }
  return { host, home, runs, unit, omo }
}

export const actions = (runs: readonly string[]) =>
  runs.filter((r) => !r.includes(" show ") && !r.endsWith(" status --json"))

export const LABEL_PLIST = (home: string, label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`)

/** launchctl and plutil over one in-memory table value; the relayd plist file only has to exist. */
export function fakeLaunchd(options: { readonly bootstrapFailures?: number } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cwd-"))
  tempHomes.push(home)
  const relayd = LABEL_PLIST(home, "ai.omo.relay-daemon")
  mkdirSync(dirname(relayd), { recursive: true })
  writeFileSync(relayd, "<plist/>")
  const state: { table: string | undefined; loaded: Set<string>; failures: number } = {
    table: undefined,
    loaded: new Set(),
    failures: options.bootstrapFailures ?? 0,
  }
  const runs: string[] = []
  const omo = fakeOmoHost(true)
  const run: RunCommand = async (argv) => {
    runs.push(argv.join(" "))
    if (argv[0] === "/usr/bin/env") return omo.answer(argv)
    const [tool, verb, target, value] = argv
    if (tool === "plutil" && verb === "-extract")
      return target === "EnvironmentVariables" || state.table !== undefined
        ? ok(`${state.table ?? ""}\n`)
        : { exitCode: 1, output: "No value at that key path" }
    if (tool === "plutil" && verb === "-replace") state.table = argv[4]
    if (tool === "plutil" && verb === "-remove") state.table = undefined
    if (tool === "launchctl" && verb === "print")
      return state.loaded.has(target ?? "") ? ok() : { exitCode: 113, output: "not found" }
    if (tool === "launchctl" && verb === "bootout") state.loaded.delete(target ?? "")
    if (tool === "launchctl" && verb === "bootstrap") {
      if (state.failures-- > 0) return { exitCode: 5, output: "Bootstrap failed: 5: Input/output error" }
      state.loaded.add(
        `${target}/${value?.endsWith("ai.omo.session-host.plist") ? "ai.omo.session-host" : "ai.omo.relay-daemon"}`,
      )
    }
    return ok()
  }
  const host: ColdWakeHost = { platform: "darwin", home, uid: 501, run, pause: async () => {} }
  return { host, home, runs, state, relayd, omo }
}
