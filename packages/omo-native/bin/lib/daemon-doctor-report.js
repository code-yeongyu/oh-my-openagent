import { DAEMON_EXIT } from "./daemon-args.js"
import { daemonConfigDoctorLines } from "./daemon-config.js"
import { parseEngineLine, readAllEndpoints } from "./daemon-operations.js"
import { formatDoctorLines } from "./daemon-status.js"

/**
 * The `omo doctor` view: one INFO line, never a FAIL - a machine without a daemon is healthy,
 * it just has nothing shared to report. Returned as lines so doctor can place it with the rest.
 */
export function daemonReportLines(options) {
  const configLines = daemonConfigDoctorLines({
    pluginRoot: options.pluginRoot,
    agentDir: options.agentDir,
    env: options.env,
    cwd: options.cwd,
    loadRuntime: options.loadTaskConfig,
  })
  return [...engineReportLines(options), ...configLines]
}

function engineReportLines({ engine, agentDir, env, platform }) {
  if (platform === "win32") return ["INFO Daemon: unavailable on win32 (no unix socket to share)"]
  const all = readAllEndpoints(engine, agentDir, env)
  if (all.kind === "all") {
    if (all.endpoints.length === 0) return ["INFO Daemon: not running"]
    return formatDoctorLines(all.endpoints)
  }
  const result = engine.run(["host", "status", "--json"], { env: { ...env, OMO_AGENT_DIR: agentDir } })
  const parsed = parseEngineLine(result.stdout ?? "")
  if (result.exitCode !== DAEMON_EXIT.ok || parsed === undefined) {
    return ["INFO Daemon: not running", "INFO Hosts: engine too old to enumerate"]
  }
  const sessions = parsed.sessions?.total ?? parsed.sessions?.length ?? 0
  const parts = [
    `pid ${parsed.pid}`,
    parsed.instanceId === undefined ? undefined : `instance ${parsed.instanceId}`,
    parsed.engineVersion === undefined ? undefined : `engine ${parsed.engineVersion}`,
    `${sessions} session(s)`,
    `zombies ${parsed.zombies ?? 0}`,
  ].filter(Boolean)
  return [`INFO Daemon: running ${parts.join(" · ")}`, "INFO Hosts: engine too old to enumerate"]
}
