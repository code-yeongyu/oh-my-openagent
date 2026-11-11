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
  buildIdentityPaths,
  describeRuntimeCapExcess,
  formatRuntimeBytes,
  measureRuntimeCapEvictableBytes,
  measureRuntimeSizeWithinBudget,
  measureUnreflectedJournalBytes,
  readLastRetentionLogEntry,
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

function lastCleanupText(entry) {
  return entry.lastCleanup === undefined ? "; no cleanup recorded" : `; last cleanup ${entry.lastCleanup.at} removed ${entry.lastCleanup.total}`
}

function formatMemoryRuntimeLines(identities, totalBytes) {
  if (identities.length === 0) return []
  const bySize = [...identities].sort((left, right) => right.bytes - left.bytes || left.identity.localeCompare(right.identity))
  const lines = bySize.slice(0, LISTED_IDENTITIES).map((entry) => {
    if (entry.sizeUnknown !== undefined) return `INFO memory runtime: ${entry.identity} size unknown (${capText(entry.maxBytes)})${lastCleanupText(entry)}`
    const standing = runtimeSizeStanding(entry.bytes, entry.maxBytes)
    const share = standing.percent === undefined ? "" : `, ${standing.percent}%`
    return `INFO memory runtime: ${entry.identity} ${formatRuntimeBytes(entry.bytes)} (${capText(entry.maxBytes)}${share})${lastCleanupText(entry)}`
  })
  const rest = bySize.slice(LISTED_IDENTITIES)
  if (rest.length > 0) {
    const restBytes = rest.reduce((sum, entry) => sum + entry.bytes, 0)
    lines.push(`INFO memory runtime: ${rest.length} more identities hold ${formatRuntimeBytes(restBytes)}`)
  }
  const unknown = identities.filter((entry) => entry.sizeUnknown !== undefined).length
  lines.push(`INFO memory runtime total: ${formatRuntimeBytes(totalBytes)} across ${identities.length} identit${identities.length === 1 ? "y" : "ies"}${unknown === 0 ? "" : ` (${unknown} not measured)`}`)
  for (const entry of bySize) {
    if (entry.sizeUnknown !== undefined) {
      lines.push(`WARN memory runtime (${entry.identity}): size unknown: measurement exceeded ${entry.sizeUnknown.budgetMs} ms on ${entry.sizeUnknown.at}`)
      continue
    }
    const excess = describeRuntimeCapExcess({
      overCapBytes: entry.maxBytes > 0 ? entry.bytes - entry.maxBytes : 0,
      evictableBytes: entry.evictableBytes ?? 0,
      unreflectedBytes: entry.unreflectedBytes ?? 0,
      discardUnreflectedJournals: entry.discardUnreflectedJournals,
    })
    // Over the cap, the excess line says what the next pass does; the near-cap line is for 80-100 %.
    if (excess !== undefined) {
      lines.push(`WARN memory runtime (${entry.identity}): ${excess}; raise memory.runtime.max_bytes, or set it to 0, to keep more.`)
      continue
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
 * @param options.measureBudgetMs each identity's measurement deadline, the one `/doctor` uses (default: the shipped pass_budget_ms)
 * @param options.measureSignal a caller deadline that replaces the per-identity timer
 * @returns {Promise<{ identities: { identity: string, bytes: number, maxBytes: number, unreflectedBytes?: number, discardUnreflectedJournals: boolean, evictableBytes?: number, sizeUnknown?: { budgetMs: number, at: string }, lastCleanup?: { at: string, total: number } }[], totalBytes: number, lines: string[] }>}
 */
export async function memoryRuntimeReport(options = {}) {
  const root = memoryRoot(options.env ?? process.env)
  const agentsRoot = join(root, "agents")
  const maxBytesFor = options.maxBytesFor ?? (() => DEFAULT_RUNTIME_MAX_BYTES)
  const discardFor = options.discardFor ?? (() => false)
  const budgetMs = options.measureBudgetMs ?? DEFAULT_RUNTIME_RETENTION.passBudgetMs
  const identities = []
  for (const identity of options.listIdentities?.(agentsRoot) ?? listDurableIdentities(agentsRoot)) {
    const paths = buildIdentityPaths(root, identity)
    const maxBytes = maxBytesFor(identity)
    const discardUnreflectedJournals = discardFor(identity)
    // The removal log a retention pass appends (#12932); an unreadable log reads as none recorded.
    const lastCleanup = await readLastRetentionLogEntry(paths.runtime).catch(() => undefined)
    const cleaned = lastCleanup === undefined ? {} : { lastCleanup }
    // One deadline per identity bounds the size walk and the journal scans that read whole transcripts.
    const signal = options.measureSignal ?? AbortSignal.timeout(budgetMs)
    const startedAt = Date.now()
    const measured = await measureRuntimeSizeWithinBudget(paths.runtime, { budgetMs, now: startedAt, signal })
    if ("sizeUnknown" in measured) {
      identities.push({ identity, bytes: 0, maxBytes, discardUnreflectedJournals, sizeUnknown: measured.sizeUnknown, ...cleaned })
      continue
    }
    const bytes = measured.size.bytes
    const policy = { ...DEFAULT_RUNTIME_RETENTION, discardUnreflectedJournals }
    const overCap = maxBytes > 0 && bytes > maxBytes
    let unreflectedBytes
    let evictableBytes
    try {
      // Printed only on the over-cap line, and only with the switch off.
      unreflectedBytes = overCap && !discardUnreflectedJournals ? await measureUnreflectedJournalBytes({ paths, policy, signal }) : undefined
      evictableBytes = overCap ? await measureRuntimeCapEvictableBytes({ paths, policy, now: Date.now, signal }) : undefined
    } catch (error) {
      if (!signal.aborted) throw error
      identities.push({ identity, bytes: 0, maxBytes, discardUnreflectedJournals, sizeUnknown: { budgetMs, at: new Date(startedAt).toISOString() }, ...cleaned })
      continue
    }
    identities.push({
      identity,
      bytes,
      maxBytes,
      discardUnreflectedJournals,
      ...(unreflectedBytes === undefined ? {} : { unreflectedBytes }),
      ...(evictableBytes === undefined ? {} : { evictableBytes }),
      ...cleaned,
    })
  }
  const totalBytes = identities.reduce((sum, entry) => sum + entry.bytes, 0)
  return { identities, totalBytes, lines: formatMemoryRuntimeLines(identities, totalBytes) }
}
