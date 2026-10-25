import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { promisify } from "node:util"
import { setTimeout } from "node:timers/promises"
import { hostStopBudgetMs, postDrainStopReserveMs } from "../../packages/omo-native/bin/lib/daemon-stop-budget.js"

const exec = promisify(execFile)
const EXEC_MARGIN_MS = 5_000

export function smokeStopCommand(env, endpointCount) {
  const budgetMs = hostStopBudgetMs(env)
  return {
    args: ["daemon", "stop", "--all", "--wait", "--timeout", String(budgetMs / 1_000)],
    // stop --all requests and then awaits each endpoint serially. Allow both
    // the engine's stop request and our observation wait for every endpoint.
    timeout: Math.max(1, endpointCount) * budgetMs * 2 + EXEC_MARGIN_MS,
  }
}

function readProcStat(pid) {
  return readFileSync(`/proc/${pid}/stat`, "utf8")
}

// A zombie has already exited. It stays listed only until its parent reaps it, and a
// container whose PID 1 is not an init (node under `docker run` without --init) never does.
function isZombie(pid, readStat) {
  let stat
  try {
    stat = readStat(pid)
  } catch {
    return false
  }
  // The command name in field 2 may contain spaces and parentheses; the state follows the last ")".
  return stat.slice(stat.lastIndexOf(")") + 1).trimStart().startsWith("Z")
}

function isAlive(pid, readStat) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === "ESRCH") return false
    // EPERM proves existence, not ownership. This probe never signals an exit;
    // retain the pid for the bounded diagnostic rather than crashing.
    if (error.code === "EPERM") return true
    throw error
  }
  return !isZombie(pid, readStat)
}

export async function waitForSmokeSupervisors(supervisors, options, observer = {}) {
  const now = observer.now ?? (() => performance.now())
  const readStat = observer.readProcStat ?? readProcStat
  const alive = observer.isAlive ?? ((pid) => isAlive(pid, readStat))
  const pause = observer.pause ?? ((ms) => setTimeout(ms, undefined, { signal: options.signal }))
  const started = options.drainedAt ?? now()
  const reserveMs = postDrainStopReserveMs()
  let pending = supervisors
  while (true) {
    options.signal?.throwIfAborted()
    pending = pending.filter(({ pid }) => alive(pid))
    if (pending.length === 0) return
    const elapsedMs = now() - started
    if (elapsedMs >= reserveMs) {
      throw new Error(`shutdown leaked supervisors: ${pending.map(({ pid, command }) =>
        `pid ${pid} survived ${Math.round(elapsedMs)} ms after drain (reserve ${reserveMs} ms)${command ? `: ${command}` : ""}`
      ).join("; ")}`)
    }
    // Non-child supervisor pids have no portable exit event. Observe liveness
    // without ever extending the shared deadline, even for several supervisors.
    await pause(Math.min(50, reserveMs - elapsedMs))
  }
}

export async function stopSmokeHosts(binary, options, { supervisors = [], observer, onDrained } = {}) {
  const budgetMs = hostStopBudgetMs(options.env)
  const status = await exec(binary, ["daemon", "status", "--json"], {
    ...options, timeout: budgetMs + EXEC_MARGIN_MS,
  }).catch((error) => {
    // Exit 3 means no endpoint answers, not that inventory failed. A stalled
    // generation still appears in its JSON and still needs the stop request.
    if (error.code !== 3) throw error
    return error
  })
  const { endpoints } = JSON.parse(status.stdout.trim())
  const hosts = endpoints.filter((endpoint) => endpoint.endpoint_kind !== "tui")
  const command = smokeStopCommand(options.env, hosts.length)
  let result
  try {
    result = await exec(binary, command.args, { ...options, timeout: command.timeout })
  } catch (error) {
    const pids = hosts.flatMap((host) =>
      (host.generations ?? []).map((generation) => generation.pid).concat(host.pid ?? [])
    ).filter((pid) => pid !== undefined && pid !== null)
    throw new Error(`daemon stop failed (pid ${[...new Set(pids)].join(", ") || "?"}): ${error.message}\n${error.stdout ?? ""}${error.stderr ?? ""}`)
  }
  const drainedAt = (observer?.now ?? (() => performance.now()))()
  onDrained?.(result)
  await waitForSmokeSupervisors(supervisors, { ...options, drainedAt }, observer)
  return result
}
