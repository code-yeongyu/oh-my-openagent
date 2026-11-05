// The reflection-health gate for unreflected input (design 2.3, N4). Deleting a never- or
// partly-reflected journal discards input that was never folded into memory, which is acceptable
// only while reflection works on the identity. The gate is CLOSED when reflection is enabled and
// the identity is parked or its newest terminal event is not a success; it has no time window, so
// an identity that failed 20 days ago and never succeeded since stays closed. Inputs are the
// completion records, the abandoned/quarantined sentinels of run dirs (which write no completion
// record; dated by `generation`) and the park file; nothing else.

import { join } from "node:path"

import { readFile } from "../fs/resilient"
import { listNames } from "./policy"

const SUCCESS_OUTCOMES = new Set(["merged", "no_changes"])

export type ReflectionTerminalKind = "success" | "failed" | "abandoned" | "quarantined" | "parked"

export interface UnreflectedRetentionGate {
  readonly open: boolean
  /** The event that decided a closed gate, for the doctor line. */
  readonly newest?: { readonly kind: Exclude<ReflectionTerminalKind, "success">; readonly at: string }
}

/**
 * `admit` is asked before each record is read; once it answers false the walk stops and the gate is
 * undefined (unknown), so no unreflected input is judged on a partial read.
 */
export async function readUnreflectedRetentionGate(
  reflectionDir: string,
  reflectionEnabled: boolean,
  admit: () => boolean = () => true,
): Promise<UnreflectedRetentionGate | undefined> {
  if (!reflectionEnabled) return { open: true }
  const parkedAt = await readJson(join(reflectionDir, "park.json")).then((park) => stringField(park, "parkedAt"))
  if (parkedAt !== undefined) return { open: false, newest: { kind: "parked", at: parkedAt } }
  let lastSuccess: number | undefined
  let lastFailure: { readonly kind: "failed" | "abandoned" | "quarantined"; readonly at: number } | undefined
  const failure = (kind: "failed" | "abandoned" | "quarantined", at: number): void => {
    if (lastFailure === undefined || at > lastFailure.at) lastFailure = { kind, at }
  }
  const completions = join(reflectionDir, "completions")
  for (const name of await listNames(completions)) {
    if (!name.endsWith(".json")) continue
    if (!admit()) return undefined
    const record = await readJson(join(completions, name))
    const outcome = stringField(record, "outcome")
    const at = parse(stringField(record, "finishedAt"))
    if (outcome === undefined || at === undefined) continue
    if (SUCCESS_OUTCOMES.has(outcome)) lastSuccess = Math.max(lastSuccess ?? at, at)
    else failure("failed", at)
  }
  const runs = join(reflectionDir, "runs")
  for (const name of await listNames(runs)) {
    if (!admit()) return undefined
    // A sentinel is dated by its run's `generation` (when the run was reserved), never by when the
    // reaper wrote it: a stale run settled today must not read as today's failure (R4).
    const abandoned = parse(stringField(await readJson(join(runs, name, "abandoned.json")), "generation"))
    if (abandoned !== undefined) failure("abandoned", abandoned)
    const quarantined = parse(stringField(await readJson(join(runs, name, "quarantined.json")), "generation"))
    if (quarantined !== undefined) failure("quarantined", quarantined)
  }
  if (lastFailure === undefined || (lastSuccess !== undefined && lastSuccess >= lastFailure.at)) return { open: true }
  return { open: false, newest: { kind: lastFailure.kind, at: new Date(lastFailure.at).toISOString() } }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : undefined
}

function parse(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}
