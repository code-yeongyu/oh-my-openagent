// omo doctor: how much each durable memory identity holds under runtime/ and the total (#10144). The
// number comes from the same measure the session's size cap acts on (memory-core retention/size.ts),
// run from the generated doctor bundle, so the CLI and the cap cannot count differently.

import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  DEFAULT_RUNTIME_MAX_BYTES,
  DEFAULT_RUNTIME_RETENTION,
  formatRuntimeBytes,
  measureRuntimeSize,
  measureUnreflectedJournalBytes,
  runtimeSizeStanding,
} from "./reflection-lock.generated.js"

const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"
// The listing stays readable on hosts with thousands of identities; the total and every warning still
// cover all of them.
const LISTED_IDENTITIES = 10

function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

function listDurableIdentities(agentsRoot) {
  try {
    return readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(agentsRoot, name, "repo")))
      .sort()
  } catch {
    return []
  }
}

const requireRuntime = createRequire(import.meta.url)
const TASK_CONFIG_RUNTIME = join("runtime", "task-config", "index.js")

/**
 * `memory.runtime.max_bytes` per identity, read through the staged config runtime (the loader every
 * other omo.json key goes through). Fail-open: a payload without the runtime, or any error in it,
 * reads the shipped default.
 */
function loadMemoryRuntimeCaps(options) {
  try {
    const runtime = (options.loadRuntime ?? ((pluginRoot) => requireRuntime(join(pluginRoot, TASK_CONFIG_RUNTIME))))(options.pluginRoot)
    return runtime.resolveMemoryRuntimeCaps({ cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env })
  } catch {
    return undefined
  }
}

export function memoryRuntimeMaxBytesResolver(options) {
  const caps = loadMemoryRuntimeCaps(options)
  return (identity) => caps?.agents[identity] ?? caps?.maxBytes ?? DEFAULT_RUNTIME_MAX_BYTES
}

/** `memory.runtime.discard_unreflected_journals` per identity, from the same loader; fail-open to the shipped false. */
export function memoryRuntimeDiscardResolver(options) {
  const caps = loadMemoryRuntimeCaps(options)
  return (identity) => caps?.discardAgents?.[identity] ?? caps?.discardUnreflectedJournals ?? false
}

function capText(maxBytes) {
  return maxBytes > 0 ? `${formatRuntimeBytes(maxBytes)} cap` : "no cap"
}

export function formatMemoryRuntimeLines(identities, totalBytes) {
  if (identities.length === 0) return []
  const bySize = [...identities].sort((left, right) => right.bytes - left.bytes || left.identity.localeCompare(right.identity))
  const lines = bySize.slice(0, LISTED_IDENTITIES).map((entry) => {
    const standing = runtimeSizeStanding(entry.bytes, entry.maxBytes)
    const share = standing.percent === undefined ? "" : `, ${standing.percent}%`
    return `INFO memory runtime: ${entry.identity} ${formatRuntimeBytes(entry.bytes)} (${capText(entry.maxBytes)}${share})`
  })
  const rest = bySize.slice(LISTED_IDENTITIES)
  if (rest.length > 0) {
    const restBytes = rest.reduce((sum, entry) => sum + entry.bytes, 0)
    lines.push(`INFO memory runtime: ${rest.length} more identities hold ${formatRuntimeBytes(restBytes)}`)
  }
  lines.push(`INFO memory runtime total: ${formatRuntimeBytes(totalBytes)} across ${identities.length} identit${identities.length === 1 ? "y" : "ies"}`)
  for (const entry of bySize) {
    const overCap = entry.maxBytes > 0 ? entry.bytes - entry.maxBytes : 0
    if (overCap > 0 && !entry.discardUnreflectedJournals && entry.unreflectedBytes > 0) {
      lines.push(`WARN memory runtime (${entry.identity}): cap exceeded by ${formatRuntimeBytes(overCap)}, nothing evictable; held by unreflected journals: ${formatRuntimeBytes(entry.unreflectedBytes)} (discard_unreflected_journals off)`)
    }
    const standing = runtimeSizeStanding(entry.bytes, entry.maxBytes)
    if (standing.level !== "warn") continue
    lines.push(`WARN memory runtime is near its size cap (${entry.identity}): ${formatRuntimeBytes(entry.bytes)} is ${standing.percent}% of the ${formatRuntimeBytes(entry.maxBytes)} cap (memory.runtime.max_bytes). The next maintenance pass evicts the oldest runtime data down to the cap; raise the cap, or set it to 0, to keep more.`)
  }
  return lines
}

/**
 * @param options.env where OMO_MEMORY_HOME is read
 * @param options.maxBytesFor the resolved `memory.runtime.max_bytes` for one identity (default: the shipped default)
 * @param options.discardFor the resolved `memory.runtime.discard_unreflected_journals` for one identity (default: the shipped false)
 * @returns {Promise<{ identities: { identity: string, bytes: number, maxBytes: number, unreflectedBytes: number, discardUnreflectedJournals: boolean }[], totalBytes: number, lines: string[] }>}
 */
export async function memoryRuntimeReport(options = {}) {
  const agentsRoot = join(memoryRoot(options.env ?? process.env), "agents")
  const maxBytesFor = options.maxBytesFor ?? (() => DEFAULT_RUNTIME_MAX_BYTES)
  const discardFor = options.discardFor ?? (() => false)
  const identities = []
  for (const identity of options.listIdentities?.(agentsRoot) ?? listDurableIdentities(agentsRoot)) {
    const runtime = join(agentsRoot, identity, "runtime")
    const size = await measureRuntimeSize(runtime)
    const unreflectedBytes = await measureUnreflectedJournalBytes({
      paths: { transcripts: join(runtime, "transcripts") },
      policy: DEFAULT_RUNTIME_RETENTION,
    })
    identities.push({ identity, bytes: size.bytes, maxBytes: maxBytesFor(identity), unreflectedBytes, discardUnreflectedJournals: discardFor(identity) })
  }
  const totalBytes = identities.reduce((sum, entry) => sum + entry.bytes, 0)
  return { identities, totalBytes, lines: formatMemoryRuntimeLines(identities, totalBytes) }
}
