import { DAEMON_EXIT } from "./daemon-args.js"
import { daemonConfigFindings } from "./daemon-config.js"
import { parseEngineLine, readAllEndpoints } from "./daemon-operations.js"
import { endpointFindings } from "./daemon-status.js"
import { finding } from "./diagnostics-findings.js"

/**
 * The `omo doctor` view: INFO findings, never a FAIL - a machine without a daemon is healthy,
 * it just has nothing shared to report.
 */
export function daemonFindings(options) {
  const config = daemonConfigFindings({
    pluginRoot: options.pluginRoot,
    agentDir: options.agentDir,
    env: options.env,
    cwd: options.cwd,
    loadRuntime: options.loadTaskConfig,
  })
  return [...engineFindings(options), ...config]
}

const NOT_RUNNING = finding("daemon", "notice", "Daemon: not running", { state: "not_running" })
const TOO_OLD = finding("daemon", "notice", "Hosts: engine too old to enumerate", { state: "engine_too_old" })

function engineFindings({ engine, agentDir, env, platform }) {
  if (platform === "win32")
    return [
      finding("daemon", "notice", "Daemon: unavailable on win32 (no unix socket to share)", { state: "unsupported" }),
    ]
  const all = readAllEndpoints(engine, agentDir, env)
  if (all.kind === "all") {
    if (all.endpoints.length === 0) return [NOT_RUNNING]
    return endpointFindings(all.endpoints)
  }
  const result = engine.run(["host", "status", "--json"], { env: { ...env, OMO_AGENT_DIR: agentDir } })
  const parsed = parseEngineLine(result.stdout ?? "")
  if (result.exitCode !== DAEMON_EXIT.ok || parsed === undefined) {
    return [NOT_RUNNING, TOO_OLD]
  }
  const sessions = parsed.sessions?.total ?? parsed.sessions?.length ?? 0
  const parts = [
    `pid ${parsed.pid}`,
    parsed.instanceId === undefined ? undefined : `instance ${parsed.instanceId}`,
    parsed.engineVersion === undefined ? undefined : `engine ${parsed.engineVersion}`,
    `${sessions} session(s)`,
    `zombies ${parsed.zombies ?? 0}`,
  ].filter(Boolean)
  return [
    finding("daemon", "notice", `Daemon: running ${parts.join(" · ")}`, {
      state: "running",
      pid: parsed.pid,
      sessions,
    }),
    TOO_OLD,
  ]
}
