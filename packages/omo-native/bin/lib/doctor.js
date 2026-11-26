// `omo doctor`: parse the arguments, make one diagnostics call, render it. Every check, repair and
// refusal is decided in the diagnostics core (diagnostics.js), the same body the SDK exposes.
import { findingsFromLines, renderFindings } from "./diagnostics-findings.js"
import { reapStaleEngines as reap, run } from "./diagnostics.js"
import { reflectionLockFix } from "./doctor-reflection-lock.js"
import { exitOf, REAP_EXIT_SURFACE } from "./reap-exit.js"
import { MANAGED_MODE_FLAG } from "./engine-processes.js"
import { releaseChannel } from "./package-paths.js"

export function installedDistTag(version) {
  return releaseChannel(version)
}

const REAP_USAGE = "FAIL --reap needs the pids to terminate: omo doctor --reap <pid> [pid...]"

function reapLine(engine) {
  if (engine.outcome === "reaped")
    return `PASS reaped stale engine pid ${engine.pid} (age ${engine.age}, tty ${engine.tty})`
  if (engine.outcome === "not_found") return `FAIL refusing pid ${engine.pid}: it is not an omo engine process`
  switch (engine.reason) {
    case "not_an_engine":
      return `FAIL refusing pid ${engine.pid}: it is not an omo engine process`
    case "managed_engine":
      return `FAIL refusing pid ${engine.pid}: it is a managed engine (${MANAGED_MODE_FLAG}), owned by whatever started it`
    case "live_session":
      return `FAIL refusing pid ${engine.pid}: its launcher (pid ${engine.details.launcher_pid}) is alive, so it is a live session`
    case "signal_failed":
      return `FAIL could not signal pid ${engine.pid}: ${engine.details.reason}`
    default:
      throw new TypeError(`doctor: an unknown reap refusal ${JSON.stringify(engine.reason)}`)
  }
}

// `omo doctor --reap <pid>...` as lines, in request order. A word that is not a pid is the command's own argv refusal; the
// named pids go to the one reap body, and its typed answer renders: each engine's outcome, or a request-level refusal.
export async function reapStaleEngines(args, options = {}) {
  if (args.length === 0) return { lines: [REAP_USAGE], failed: true, reaped: [] }
  const lines = []
  const pids = []
  for (const arg of args) {
    if (/^[1-9]\d*$/.test(arg)) pids.push(Number(arg))
    else lines.push(`FAIL refusing ${JSON.stringify(arg)}: --reap takes process ids`)
  }
  if (pids.length === 0) return { lines, failed: true, reaped: [] }
  const argvRefused = lines.length > 0
  const result = await reap({ pids }, options)
  const engines = result.kind === "ok" ? result.value.engines : (result.error.details?.engines ?? [])
  if (result.kind === "error" && result.error.details?.engines === undefined) lines.push(`FAIL ${result.error.message}`)
  lines.push(...engines.map(reapLine))
  return {
    lines,
    // Every exit past the command's own argv refusals is the SDK answer's (REAP_EXIT_SURFACE).
    failed: argvRefused || exitOf(REAP_EXIT_SURFACE, result) !== 0,
    reaped: engines.filter((engine) => engine.outcome === "reaped").map((engine) => engine.pid),
  }
}

export async function printDoctorReap(args, ports = {}) {
  const result = await reapStaleEngines(args, ports)
  console.log(result.lines.join("\n"))
  return result.failed ? 1 : 0
}

export async function printDoctorReport(ports = {}) {
  const result = await run({}, ports)
  if (result.kind === "error") {
    console.log(`FAIL ${result.error.message}`)
    return 1
  }
  console.log(renderFindings(result.value.findings).join("\n"))
  return result.value.failed ? 1 : 0
}

export async function printDoctorFix(args, ports = {}) {
  const extra = args.filter((arg) => arg !== "--dry-run")
  if (extra.length > 0) {
    console.log(`FAIL unknown argument ${JSON.stringify(extra[0])}: omo doctor --fix [--dry-run]`)
    return 1
  }
  const result = await reflectionLockFix({ ...ports, dryRun: args.includes("--dry-run") })
  console.log(result.lines.join("\n"))
  return result.failed ? 1 : 0
}

const givenFindings = (check, lines) => async () => findingsFromLines(check, lines ?? [])

/**
 * The report from precomputed section lines: a section that is not passed prints nothing, as it
 * always has here. `--reap` reaps instead.
 */
export async function runDoctor(inventory, args = [], options = {}) {
  if (args[0] === "--reap") {
    process.exitCode = await printDoctorReap(args.slice(1), options)
    return
  }
  process.exitCode = await printDoctorReport({
    ...options,
    inventory,
    // As before the move: this seam reports the daemon only from the lines or the engine its caller passes.
    daemon:
      options.daemonReport !== undefined
        ? () => findingsFromLines("daemon", options.daemonReport())
        : options.daemonEngine === undefined
          ? () => []
          : undefined,
    keychainHelper:
      options.keychainHelper === undefined
        ? undefined
        : () => findingsFromLines("keychain-helper", options.keychainHelper),
    configDiagnostics: givenFindings("config.diagnostics", options.configDiagnostics),
    reflectionLock: givenFindings("memory.reflection-lock", options.reflectionLock),
    memoryRuntime: givenFindings("memory.runtime", options.memoryRuntime),
    computerUse: givenFindings("computer-use", options.computerUse),
    categoryCoverage: givenFindings("task-categories", options.categoryCoverage),
  })
}
