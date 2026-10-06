import { existsSync, rmSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { decorateEndpoints, formatEndpointLines, statusPayload } from "./daemon-status.js"

export function parseEngineLine(stdout) {
  const line = stdout.trim().split("\n").filter(Boolean).pop()
  if (line === undefined) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

export function readAllEndpoints(engine, agentDir, env) {
  const result = engine.run(["host", "status", "--json", "--all", "--include-workers"], {
    env: { ...env, OMO_AGENT_DIR: agentDir },
  })
  const parsed = parseEngineLine(result.stdout ?? "")
  if (result.exitCode === 2 || !Array.isArray(parsed?.endpoints)) return { kind: "legacy", result }
  const endpoints = decorateEndpoints(parsed.endpoints, agentDir)
  return { kind: "all", result, endpoints }
}

export function runStatus({ engine, agentDir, env, json, stdout, stderr, _test }) {
  const all = readAllEndpoints(engine, agentDir, env)
  if (all.kind === "legacy") return { legacy: true, result: all.result }
  if (all.result.stderr) stderr.write(all.result.stderr)
  _test?.afterRead?.({ agentDir, endpoints: all.endpoints })
  if (all.endpoints.length === 0 && all.result.exitCode !== 0) {
    if (json) stdout.write(`${JSON.stringify(statusPayload([]))}\n`)
    else stdout.write("daemon: not running\n")
    return { legacy: false, exitCode: all.result.exitCode, endpoints: [] }
  }
  if (json) stdout.write(`${JSON.stringify(statusPayload(all.endpoints))}\n`)
  else stdout.write(`${formatEndpointLines(all.endpoints).join("\n")}\n`)
  return { legacy: false, exitCode: all.result.exitCode, endpoints: all.endpoints }
}

/** A terminal (`tui`) endpoint is owned by its terminal: no lifecycle command ensures, hands off, drains, stops or waits on it. */
function operable(endpoint) {
  return endpoint.endpoint_kind !== "tui"
}

function liveEndpoints(endpoints) {
  return endpoints.filter((endpoint) => operable(endpoint) && endpoint.reachable && typeof endpoint.socket === "string")
}

function ownedEndpoints(endpoints) {
  return endpoints.filter((endpoint) => {
    if (!operable(endpoint) || typeof endpoint.socket !== "string") return false
    return endpoint.reachable ||
      (endpoint.generations ?? []).some((generation) => generation.alive) ||
      (endpoint.claims_live ?? 0) > 0
  })
}

function endpointCall(engine, args, agentDir, env) {
  const result = engine.run(args, { env: { ...env, OMO_AGENT_DIR: agentDir } })
  return { result, parsed: parseEngineLine(result.stdout ?? "") }
}

export function runGc({ engine, migration, agentDir, env, json, pruneStoreIndex, stdout, stderr }) {
  const { result, parsed } = endpointCall(engine, ["host", "gc", "--json"], agentDir, env)
  if (result.stderr) stderr.write(result.stderr)
  const removed = Array.isArray(parsed?.removed) ? parsed.removed : []
  const kept = Array.isArray(parsed?.kept) ? parsed.kept : []
  const reapedMeta = []
  for (const entry of removed) {
    if (typeof entry.socket !== "string") continue
    const meta = entry.socket.replace(/\.sock$/, ".meta.json")
    if (!existsSync(meta)) continue
    rmSync(meta, { force: true })
    reapedMeta.push(meta)
  }
  const prunedStores = pruneStoreIndex
    ? migration.run({ operation: "prune-store-index", indexPath: join(agentDir, "rpc", "task-stores.json") }).removed
    : []
  const payload = { removed, kept, reaped_meta: reapedMeta, pruned_stores: prunedStores }
  if (json) stdout.write(`${JSON.stringify(payload)}\n`)
  else stdout.write(`reaped: ${removed.length}\n`)
  return result.exitCode
}

export function runHandoff({ engine, pluginRoot, agentDir, env, policy, config, stdout, stderr }) {
  const all = readAllEndpoints(engine, agentDir, env)
  if (all.kind === "legacy") {
    const call = endpointCall(
      engine,
      buildEnsureArgs("handoff", undefined, pluginRoot, policy),
      agentDir,
      hostCommandEnvironment(env, agentDir, config),
    )
    if (call.result.stderr) stderr.write(call.result.stderr)
    stdout.write(`daemon: ${call.parsed?.action ?? "handoff"}\n`)
    return call.result.exitCode
  }
  let refused = false
  const commandEnv = hostCommandEnvironment(env, agentDir, config)
  for (const endpoint of all.endpoints) {
    if (!operable(endpoint) && typeof endpoint.socket === "string") stdout.write(`${endpoint.socket}: skipped (tui endpoint, owned by its terminal)\n`)
  }
  for (const endpoint of liveEndpoints(all.endpoints)) {
    const daemon = basename(endpoint.socket) === "rpc.sock"
    const args = daemon
      ? buildEnsureArgs("handoff", undefined, pluginRoot, policy)
      : buildEnsureArgs("ensure", endpoint.socket, pluginRoot, policy)
    const call = endpointCall(engine, args, agentDir, commandEnv)
    if (call.result.stderr) stderr.write(call.result.stderr)
    if (call.result.exitCode !== 0 || call.parsed?.action === "refuse") refused = true
    stdout.write(`${endpoint.socket}: ${call.parsed?.action ?? "refuse"}\n`)
  }
  return refused ? 3 : 0
}

function buildEnsureArgs(command, socket, pluginRoot, policy) {
  const args = ["host", command, "--json"]
  if (socket !== undefined) args.push("--socket", socket)
  args.push("--launch-spec", join(pluginRoot, "daemon-launch-spec.json"), "--policy", policy)
  return args
}

export function hostCommandEnvironment(env, agentDir, config) {
  const result = { ...env, OMO_AGENT_DIR: agentDir }
  const idleExitMs = config?.task?.host_idle_exit_ms
  if (typeof idleExitMs === "number" && Number.isFinite(idleExitMs) && idleExitMs > 0) {
    result.SENPI_RPC_HOST_IDLE_EXIT_MS = String(Math.trunc(idleExitMs))
  }
  return result
}

export function runStopAll({ engine, agentDir, env, drain, wait, timeoutSeconds, stdout, stderr, now, pause }) {
  const all = readAllEndpoints(engine, agentDir, env)
  if (all.kind === "legacy") return undefined
  let failed = false
  for (const endpoint of ownedEndpoints(all.endpoints)) {
    const args = ["host", "stop", "--json", "--socket", endpoint.socket]
    if (drain) args.push("--drain")
    const call = endpointCall(engine, args, agentDir, env)
    if (call.result.stderr) stderr.write(call.result.stderr)
    if (!wait) {
      if (call.result.exitCode !== 0) failed = true
      stdout.write(`${endpoint.socket}: requested (not awaited)\n`)
      continue
    }
    const action = call.parsed?.action
    const refusal = action === "refuse" ? call.parsed?.reason : action
    const liveAtRequest = (endpoint.generations ?? []).some((generation) => generation.alive)
    const claimsAtRequest = (endpoint.claims_live ?? 0) > 0
    const ownedAtRequest = liveAtRequest || claimsAtRequest
    if (
      call.result.exitCode !== 0 &&
      !(ownedAtRequest && (refusal === "drain_unsupported" || refusal === "unknown_owner"))
    ) {
      if (!ownedAtRequest) {
        stdout.write(`${endpoint.socket}: already drained\n`)
        continue
      }
      failed = true
      stdout.write(`${endpoint.socket}: refused\n`)
      continue
    }
    const result = waitForEndpoint(engine, endpoint.socket, agentDir, env, timeoutSeconds, now, pause)
    if (result.done) stdout.write(`${endpoint.socket}: drained (${result.polls} polls)\n`)
    else {
      failed = true
      stdout.write(`${endpoint.socket}: TIMEOUT: still live (${result.summary})\n`)
    }
  }
  return failed ? 3 : 0
}

function waitForEndpoint(engine, socket, agentDir, env, timeoutSeconds, now, pause) {
  const deadline = now() + timeoutSeconds * 1_000
  let polls = 0
  let latest
  while (now() <= deadline) {
    const call = endpointCall(engine, ["host", "status", "--json", "--socket", socket, "--include-workers"], agentDir, env)
    latest = call.parsed
    polls += 1
    const alive = (latest?.generations ?? []).some((generation) => generation.alive)
    if (!alive && (latest?.claims_live ?? 0) === 0) return { done: true, polls }
    pause(250)
  }
  const pid = latest?.pid ?? "?"
  const sessions = latest?.sessions?.total ?? 0
  const claims = latest?.claims_live ?? 0
  return { done: false, polls, summary: `pid ${pid}, ${sessions} sessions, ${claims} claims` }
}

export function parseStoreArgs(args) {
  const stores = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--store" && args[index + 1] !== undefined) stores.push(resolve(args[index + 1]))
  }
  return stores
}
