import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  parseEngineLine,
  parseStoreArgs,
  hostCommandEnvironment,
  runGc,
  runHandoff,
  runStatus,
  runStopAll,
} from "./daemon-operations.js"
import { runRollbackPrepare } from "./daemon-rollback.js"
import { attachLaunchArgs, blockingPause, DAEMON_EXIT, readTimeoutSeconds } from "./daemon-args.js"
import { readDaemonConfig } from "./daemon-config.js"

export { DAEMON_EXIT } from "./daemon-args.js"
export { daemonReportLines } from "./daemon-doctor-report.js"

/**
 * `omo daemon` - the operator's view of every engine host in one agent dir: the operator daemon on
 * `rpc.sock` (the only endpoint `run` and `attach` ensure), each session's task host (`p-*`), each
 * Desktop thread host (`i-*`), and any other endpoint the engine enumerates. `status`, `gc`,
 * `handoff`, `stop --all` and `rollback-prepare` cover all of them.
 *
 * Everything that decides WHO serves a socket lives in the engine (`senpi host`): probing an
 * existing host, comparing build ordinals, handing a generation over, refusing when the two sides
 * cannot agree. This wrapper owns three much smaller things, and deliberately nothing else:
 * omo's launch spec is the argv source, the omo config is where the policy comes from, and the caller
 * gets an exit code it can branch on without reading prose.
 */

const SUBCOMMANDS = new Set(["run", "attach", "status", "stop", "handoff", "gc", "rollback-prepare"])
/** The subcommands that can bring a host into existence, and therefore need omo's argv source. */
const NEEDS_SPEC = new Set(["run", "attach", "handoff"])

const USAGE = [
  "usage: omo daemon <run|attach|status|stop|handoff|gc|rollback-prepare> [options]",
  "",
  "  run       ensure a daemon is serving this agent dir (start, reuse, or hand off)",
  "  attach    print the environment a child needs to reach the daemon",
  "  status    report who is serving and which sessions exist",
  "  stop      end the daemon; --drain lets in-flight work finish first",
  "  handoff   hand the socket to this build, keeping live sessions",
  "  gc        remove dead endpoint state; --prune-store-index drops missing store paths",
  "  rollback-prepare migrate retained task records back to rpc.sock before downgrading",
  "",
  "  --json            print the engine's JSON line instead of a summary",
  "  --no-upgrade      never hand off, even from an older build",
  "  --include-workers include subagent sessions in status",
  "  --all             apply stop to every discovered endpoint",
  "  --wait            with stop --drain --all, wait for generations and claims to end",
].join("\n")

/**
 * The policy the engine is allowed to apply. A flag beats config, config beats the default,
 * and the default is the one that keeps a newer build from being blocked by an older one.
 */
function resolvePolicy(args, config) {
  if (args.includes("--no-upgrade")) return "never"
  const configured = config?.task?.host_engine_policy
  if (configured === "fallback" || configured === "never" || configured === "upgrade") return configured
  return "upgrade"
}

/**
 * The engine owns four subcommands - ensure, status, stop, handoff. `run` and `attach` are omo's
 * words for the same ensure: one asks for a daemon, the other asks for a daemon plus the
 * environment to reach it. Mapping them here is what keeps this file from inventing a fifth.
 */
const ENGINE_SUBCOMMAND = { run: "ensure", attach: "ensure", status: "status", stop: "stop", handoff: "handoff" }

function buildArgs(subcommand, args, { specPath, policy }) {
  const engineArgs = ["host", ENGINE_SUBCOMMAND[subcommand], "--json"]
  if (subcommand === "run" || subcommand === "attach" || subcommand === "handoff") {
    engineArgs.push("--launch-spec", specPath, "--policy", policy)
  }
  if (subcommand === "stop" && args.includes("--drain")) engineArgs.push("--drain")
  if (subcommand === "status" && args.includes("--include-workers")) engineArgs.push("--include-workers")
  return engineArgs
}

/** What a child process needs in its environment to reach this daemon rather than start its own. */
function attachEnv(parsed, agentDir) {
  return {
    OMO_ENABLE_SHARED_HOST: "1",
    OMO_RPC_SOCKET: parsed?.socket ?? join(agentDir, "rpc", "rpc.sock"),
  }
}

function summarize(subcommand, parsed, exitCode) {
  if (subcommand === "status") {
    if (exitCode === DAEMON_EXIT.notRunning || parsed === undefined) return "daemon: not running"
    const sessions = parsed.sessions?.total ?? parsed.sessions?.length
    const suffix = sessions === undefined ? "" : `, ${sessions} session(s)`
    return `daemon: running pid ${parsed.pid}${suffix}`
  }
  if (parsed === undefined) return `daemon: ${subcommand} failed`
  const pid = parsed.pid === undefined ? "" : ` pid ${parsed.pid}`
  return `daemon: ${parsed.action ?? subcommand}${pid}`
}

/**
 * @param args argv after `omo daemon`
 * @param options.engine  something that can run the engine CLI; injected so tests never spawn one
 * @returns the process exit code the launcher should use
 */
export function runDaemonCommand(args, options) {
  const { engine, migration, pluginRoot, agentDir, env, stdout, stderr, platform } = options
  const subcommand = args[0]

  if (subcommand === "--help" || subcommand === "-h") {
    stdout.write(`${USAGE}\n`)
    return DAEMON_EXIT.ok
  }
  if (subcommand === undefined) {
    stderr.write(`${USAGE}\n`)
    return DAEMON_EXIT.usage
  }
  if (!SUBCOMMANDS.has(subcommand)) {
    stderr.write(`omo daemon: unknown subcommand '${subcommand}'\n${USAGE}\n`)
    return DAEMON_EXIT.usage
  }
  // A named pipe is per-process on win32: there is no socket for a second client to attach to,
  // so refusing here is honest, where pretending would strand the caller on a host it cannot reach.
  if (platform === "win32") {
    stderr.write("omo daemon: a task host needs a unix socket, which win32 does not provide\n")
    return DAEMON_EXIT.unsupported
  }
  if (args.includes("--foreground")) {
    stderr.write("omo daemon: --foreground is unsupported; the engine host always detaches\n")
    return DAEMON_EXIT.usage
  }

  // Only the subcommands that may START something need the spec; asking who is serving, or
  // asking it to stop, must still work on an install whose plugin payload was never built.
  const specPath = join(pluginRoot, "daemon-launch-spec.json")
  if (NEEDS_SPEC.has(subcommand) && !existsSync(specPath)) {
    stderr.write(`omo daemon: launch spec missing at ${specPath}\n`)
    return DAEMON_EXIT.engineRefused
  }

  const { config } = readDaemonConfig({ pluginRoot, agentDir, env, cwd: options.cwd, loadRuntime: options.loadTaskConfig })
  if (subcommand === "status") {
    const status = runStatus({
      engine,
      agentDir,
      env,
      json: args.includes("--json"),
      stdout,
      stderr,
    })
    if (!status.legacy) return status.exitCode
  }
  if (subcommand === "gc") {
    if (args.includes("--prune-store-index") && migration === undefined) {
      stderr.write("omo daemon: rollback migration runtime is unavailable\n")
      return DAEMON_EXIT.engineRefused
    }
    return runGc({
      engine,
      migration,
      agentDir,
      env,
      json: args.includes("--json"),
      pruneStoreIndex: args.includes("--prune-store-index"),
      stdout,
      stderr,
    })
  }
  if (subcommand === "rollback-prepare") {
    if (migration === undefined) {
      stderr.write("omo daemon: rollback migration runtime is unavailable\n")
      return DAEMON_EXIT.engineRefused
    }
    return runRollbackPrepare({
      engine,
      migration,
      agentDir,
      env,
      explicitStores: parseStoreArgs(args),
      allowMissingIndex: args.includes("--allow-missing-index"),
      dryRun: args.includes("--dry-run"),
      json: args.includes("--json"),
      stdout,
      stderr,
    })
  }
  if (subcommand === "handoff") {
    return runHandoff({
      engine,
      pluginRoot,
      agentDir,
      env,
      policy: resolvePolicy(args, config),
      config,
      stdout,
      stderr,
    })
  }
  if (subcommand === "stop" && args.includes("--all")) {
    const timeoutSeconds = readTimeoutSeconds(args)
    const outcome = runStopAll({
      engine,
      agentDir,
      env,
      drain: args.includes("--drain"),
      wait: args.includes("--wait"),
      timeoutSeconds,
      stdout,
      stderr,
      now: options.now ?? Date.now,
      pause: options.pause ?? blockingPause,
    })
    if (outcome !== undefined) return outcome
  }
  const engineArgs = buildArgs(subcommand, args, { specPath, policy: resolvePolicy(args, config) })
  const result = engine.run(engineArgs, { env: hostCommandEnvironment(env, agentDir, config) })
  const parsed = parseEngineLine(result.stdout ?? "")

  if (result.stderr) stderr.write(result.stderr)

  if (subcommand === "attach") {
    if (result.exitCode !== DAEMON_EXIT.ok) return result.exitCode
    const daemonEnv = attachEnv(parsed, agentDir)
    // `omo daemon attach --model x`: the trailing args are a normal omo launch that should run
    // against the daemon, so the caller gets the merged environment back and continues with them.
    const launchArgs = attachLaunchArgs(args)
    if (launchArgs.length > 0) return { passthrough: true, args: launchArgs, env: { ...env, ...daemonEnv } }
    const payload = { ...(parsed ?? {}), env: daemonEnv }
    if (args.includes("--json")) stdout.write(`${JSON.stringify(payload)}\n`)
    else for (const [key, value] of Object.entries(daemonEnv)) stdout.write(`${key}=${value}\n`)
    return DAEMON_EXIT.ok
  }

  if (args.includes("--json") && result.stdout) stdout.write(result.stdout.trim() + "\n")
  else stdout.write(`${summarize(subcommand, parsed, result.exitCode)}\n`)
  return result.exitCode
}
