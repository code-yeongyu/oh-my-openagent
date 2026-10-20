import { homedir } from "node:os"
import { resolve } from "node:path"

import {
  applySetupStages,
  authWritesPending,
  canonicalAgentDir,
  collectSetupPlans,
  scanSetup,
  SetupStaleError,
  staleSetupTargets,
  type SetupPlans,
  type SetupStageResult,
} from "../../../../omo-native/bin/lib/setup-stream.js"
import type { OnboardingEngineAuthStore } from "./scan-component"
import type { OnboardingApplyResponse, OnboardingApplyStage, OnboardingScanEvent, OnboardingScanItem, OnboardingScanSource } from "./scan-contract"
import {
  createMemorySessionDigestStore,
  defaultAgentHomes,
  MAX_TRANSCRIPTS_PER_SOURCE,
  nodeSessionHistoryFs,
  scanSessionHistory,
  type ProjectCandidate,
  type SessionDigest,
  type SessionHistoryOptions,
  type SessionScanItem,
} from "./session-history"
import { newestSessionDigests } from "./session-history/newest-sessions"
import { createProjectPathRules } from "./session-history/project-paths"

export { createOnboardingUnderstandingHandlers } from "./understand-component"
export { runTuiOnboardingScan } from "./tui-scan-runtime"
export { executeOnboardingSessionHistory } from "./session-history-tool-runtime"
export { applyMemoryFacts } from "../memory/facts-apply-runtime"
export { reconcileAppliedFactsBatches } from "../memory/facts-applied-reconcile"
export { executeOnboardingMemoryApply, executeOnboardingUnderstand } from "./tui-memory-runtime"
export { claimOnboardingOwned, readOnboardingState } from "./claim-owner"

/** Where the scan reads and the apply writes; every field defaults to what `omo setup` uses. */
export interface OnboardingScanEnvironment {
  readonly home?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly agentDir?: string
  /** Session-history overrides (agent homes, omo session roots, clock); defaults read this machine. */
  readonly sessionHistory?: SessionHistoryOptions
}

/**
 * One scan's outcome: the stage plans an apply needs, the per-source rows a UI renders, and what
 * understanding may read after consent. The digests live only in memory, with the retained scan.
 */
export interface OnboardingScanOutcome {
  readonly plans: SetupPlans
  readonly results: readonly SetupStageResult[]
  readonly digests: readonly SessionDigest[]
  /** The project roots the scan showed the user; understanding reads AGENTS.md only inside these. */
  readonly projectRoots: ReadonlySet<string>
}

type EventBody = Omit<OnboardingScanEvent, "scanId" | "elapsedMs">

/**
 * Runs `omo setup`'s own stream and reports each source as `source_started`, its items, then
 * `source_done` (or `source_failed`), ending with one `done`. Resolves with the stage plans an
 * apply needs and the source rows a UI renders; a failed source has no plan, so its stage is
 * never applied.
 */
export async function runOnboardingScan(
  environment: OnboardingScanEnvironment,
  options: {
    readonly scanId: string
    readonly includeCustomProviders: boolean
    /** False runs only `omo setup`'s sources: the TUI inventory never reads session history. */
    readonly sessions?: boolean
  },
  emit: (event: OnboardingScanEvent) => void,
): Promise<OnboardingScanOutcome> {
  const startedAt = performance.now()
  const send = (body: EventBody): void => emit({ scanId: options.scanId, ...body, elapsedMs: Math.round(performance.now() - startedAt) })
  const home = environment.home ?? homedir()
  const env = environment.env ?? process.env
  const agentDir = environment.agentDir ?? canonicalAgentDir(env, home)
  const results: SetupStageResult[] = []
  let found = 0
  const stream = scanSetup({ home, env }, agentDir, {
    includeCustomProviders: options.includeCustomProviders,
    onSourceStart: (source) => send({ kind: "source_started", source }),
  })
  for await (const result of stream) {
    results.push(result)
    if (result.disabled === true) continue
    const source: OnboardingScanSource = result.source
    if (result.error !== undefined) {
      send({ kind: "source_failed", source, reason: result.error.message })
      continue
    }
    for (const item of result.items) send({ kind: "item", source, item })
    found += result.items.length
    send({ kind: "source_done", source, counts: { found: result.items.length, read: result.items.length, cap: null } })
  }
  let read = found
  // Nothing is persisted before consent: the digests stay in memory, with the retained scan.
  const digestStore = createMemorySessionDigestStore()
  const projectRoots = new Set<string>()
  const history = options.sessions === false ? [] : scanSessionHistory({
    homeDir: home,
    env,
    ...environment.sessionHistory,
    scanId: options.scanId,
    digestStore,
  })
  for await (const event of history) {
    const source = event.source
    if (event.kind === "source_started") send({ kind: "source_started", source })
    else if (event.kind === "source_failed") send({ kind: "source_failed", source, reason: event.error ?? "unknown error" })
    else if (event.kind === "item" && event.item !== undefined) {
      if ("path" in event.item) projectRoots.add(event.item.path)
      send({ kind: "item", source, item: historyItem(event.item) })
    }
    else if (event.kind === "source_done" && event.counts !== undefined) {
      found += event.counts.found
      read += event.counts.read
      send({ kind: "source_done", source, counts: { found: event.counts.found, read: event.counts.read, cap: MAX_TRANSCRIPTS_PER_SOURCE } })
    }
  }
  send({ kind: "done", source: "all", counts: { found, read, cap: null } })
  const plans = (await collectSetupPlans(results.filter((result) => result.error === undefined))).plans
  return { plans, results, digests: await digestStore.list(options.scanId), projectRoots }
}

/** The newest sessions the TUI onboarding summarizes, and the most transcripts it opens. */
export const ONBOARDING_HISTORY_MAX_SESSIONS = 12
/** Wall-clock budget for that background summary; it aborts every pending read and reports what it had. */
export const ONBOARDING_HISTORY_BUDGET_MS = 10_000
/** Only sessions this recent describe what the user is working on now. */
export const ONBOARDING_HISTORY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const HISTORY_CLIP = 160

/**
 * The TUI onboarding's background view of this machine's agent history: the newest
 * `ONBOARDING_HISTORY_MAX_SESSIONS` recent sessions as one context line. Discovery only lists and stats
 * to order transcripts; at most that many are opened. At `budgetMs` every pending filesystem call is
 * aborted and nothing more is read. Undefined when nothing was read in time. It never runs on the first
 * prompt's path.
 */
export async function onboardingHistorySummary(
  environment: OnboardingScanEnvironment,
  budgetMs: number = ONBOARDING_HISTORY_BUDGET_MS,
): Promise<string | undefined> {
  const options: SessionHistoryOptions = {
    homeDir: environment.home ?? homedir(),
    env: environment.env ?? process.env,
    ...environment.sessionHistory,
  }
  const digests: SessionDigest[] = await newestSessionDigests({
    fs: options.fs ?? nodeSessionHistoryFs,
    createRules: (fs) => createProjectPathRules({ ...options, fs }),
    homes: options.homes ?? defaultAgentHomes(options.env ?? process.env, options.homeDir),
    nowMs: (options.now ?? Date.now)(),
    recentWindowMs: ONBOARDING_HISTORY_WINDOW_MS,
    limit: ONBOARDING_HISTORY_MAX_SESSIONS,
    signal: AbortSignal.timeout(budgetMs),
  })
  if (digests.length === 0) return undefined
  const lines = digests.map((digest) =>
    `${digest.lastActiveAt.slice(0, 10)} ${digest.source} ${digest.cwd}: ${clip(digest.firstRequest || digest.title)}${digest.outcome === "" ? "" : ` -> ${clip(digest.outcome)}`}`)
  return `Recent agent sessions on this machine (newest ${digests.length}, from a background scan; onboarding_session_history has more): ${lines.join("; ")}`
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > HISTORY_CLIP ? `${line.slice(0, HISTORY_CLIP)}...` : line
}

function historyItem(item: ProjectCandidate | SessionScanItem): OnboardingScanItem {
  if ("path" in item) return { id: item.path, kind: "project", state: item.alreadyImported ? "imported" : "found", detail: item.title }
  return { id: item.sessionKey, kind: "session", state: "found", detail: item.title, project: item.cwd }
}

export { authWritesPending, staleSetupTargets } from "../../../../omo-native/bin/lib/setup-stream.js"

/** How an apply's credential additions and notice lines travel: through the engine's locked store, and to the caller's report sink. */
export interface ApplyOnboardingScanOptions {
  readonly writeAuth?: (target: string, additions: readonly { readonly provider: string; readonly key: string }[]) => Promise<void> | void
  readonly report?: (line: string) => void
}

export type OnboardingApplyOutcome =
  | { readonly applied: readonly OnboardingApplyStage[]; readonly notices: readonly string[] }
  | { readonly kind: "stale"; readonly reason: string; readonly paths: readonly string[]; readonly applied?: readonly OnboardingApplyStage[] }

/**
 * Applies the requested stages of a finished scan with the same writers `omo setup` uses. Every
 * requested stage's targets are re-read first and compared by content hash against what the scan
 * read: anything that changed since the scan answers `{kind: "stale"}` and nothing is written,
 * and a target that changes mid-apply refuses that stage instead of writing the scan-time copy.
 */
export async function applyOnboardingScan(
  plans: SetupPlans,
  stages: ReadonlySet<OnboardingApplyStage>,
  options: ApplyOnboardingScanOptions = {},
): Promise<OnboardingApplyOutcome> {
  const requested = [...stages]
  const stale = staleSetupTargets(plans, requested)
  if (stale.length > 0) {
    return { kind: "stale", reason: `targets changed since the scan: ${stale.join(", ")}`, paths: stale }
  }
  const notices: string[] = []
  const report = (line: string): void => {
    notices.push(line)
    options.report?.(line)
  }
  try {
    const applied = [...await applySetupStages(plans, (stage) => stages.has(stage.id), report, {
      ...(options.writeAuth === undefined ? {} : { writeAuth: options.writeAuth }),
      // Files an earlier stage of this apply wrote are not a change since the scan (#10496 review).
      staleGuard: (stageId: string, written: ReadonlySet<string>) => staleSetupTargets(plans, [stageId as OnboardingApplyStage], written),
    })]
    return { applied, notices }
  } catch (error) {
    if (error instanceof SetupStaleError) {
      return {
        kind: "stale",
        reason: `targets changed since the scan: ${error.paths.join(", ")}`,
        paths: error.paths,
        ...(error.applied.length > 0 ? { applied: [...error.applied] as readonly OnboardingApplyStage[] } : {}),
      }
    }
    throw error
  }
}

/**
 * `omo.onboarding.apply` once the shell has validated the request and the retained scan: staleness,
 * the credential-store checks and the writers. It ships in this runtime so `omo.js` carries none of it.
 */
export async function applyRetainedScan(
  scanId: string,
  plans: SetupPlans,
  requested: readonly OnboardingApplyStage[],
  authStore: () => OnboardingEngineAuthStore | undefined,
): Promise<OnboardingApplyResponse> {
  // Staleness is answered before anything else: a target that changed since the scan means
  // the plans no longer describe the machine, so no store is consulted and nothing is written.
  const stale = staleSetupTargets(plans, requested)
  if (stale.length > 0) {
    return { kind: "stale", reason: `targets changed since the scan: ${stale.join(", ")}`, paths: stale }
  }
  if (authWritesPending(plans, requested)) {
    const store = authStore()
    if (store === undefined) {
      return { kind: "unavailable", reason: "The engine's credential store is not available, so credentials cannot be imported here; run omo setup --yes instead." }
    }
    const target = authTargetOf(plans)
    if (target === undefined || resolve(store.getStoragePath()) !== resolve(target)) {
      return { kind: "unavailable", reason: `The engine's credential store (${store.getStoragePath()}) is not the planned target; run omo setup --yes instead.` }
    }
  }
  const notices: string[] = []
  const outcome = await applyOnboardingScan(plans, new Set(requested), {
    ...(authStore() === undefined ? {} : {
      writeAuth: (target, additions) => writeAuthThrough(authStore() as OnboardingEngineAuthStore, target, additions),
    }),
    report: (line) => notices.push(line),
  })
  if ("kind" in outcome) {
    return outcome.applied === undefined
      ? { kind: "stale", reason: outcome.reason, paths: outcome.paths }
      : { kind: "stale", reason: outcome.reason, paths: outcome.paths, applied: outcome.applied }
  }
  return { scanId, applied: outcome.applied, ...(notices.length === 0 ? {} : { notices }) }
}

function authTargetOf(plans: Record<string, unknown>): string | undefined {
  const credentials = isRecord(plans["credentials"]) ? plans["credentials"] : undefined
  if (isRecord(credentials) && typeof credentials["target"] === "string") return credentials["target"]
  const providers = isRecord(plans["providers"]) ? plans["providers"] : undefined
  const paths = isRecord(providers) && isRecord(providers["paths"]) ? providers["paths"] : undefined
  if (paths !== undefined && typeof paths["auth"] === "string") return paths["auth"]
  return undefined
}

async function writeAuthThrough(
  store: OnboardingEngineAuthStore,
  target: string,
  additions: readonly { readonly provider: string; readonly key: string }[],
): Promise<void> {
  if (resolve(store.getStoragePath()) !== resolve(target)) {
    throw new Error(`the engine's credential store is not the planned target ${target}`)
  }
  for (const item of additions) {
    // Under the store's lock: an entry the store already holds (a login or refresh that landed
    // after the scan) is kept exactly as it is.
    await store.modify(item.provider, (current: unknown) =>
      current === undefined ? { type: "api_key", key: item.key } : undefined)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const ROWS_PER_SOURCE = 40

const SUMMARY_KINDS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["sign-ins", new Set(["api-key", "oauth"])],
  ["providers", new Set(["provider"])],
  ["MCP servers", new Set(["mcp"])],
  ["skills", new Set(["skill"])],
]

/**
 * The first-prompt context of one scan, computed from its events every time: one row per found item
 * (ids and states, never a key; capped per source with the remainder counted), failed sources, and
 * the value summary the onboarding reports.
 */
export function onboardingScanContext(scanId: string, events: readonly OnboardingScanEvent[]): string {
  const items = events.filter((event) => event.kind === "item" && event.item !== undefined)
  const lines = [`Onboarding scan ${scanId} (the same scan omo setup and the desktop app run; one row per found item):`]
  for (const source of [...new Set(items.map((event) => event.source))]) {
    const own = items.filter((event) => event.source === source)
    for (const { item } of own.slice(0, ROWS_PER_SOURCE)) {
      if (item === undefined) continue
      const detail = item.detail === undefined ? "" : ` - ${item.detail}`
      const project = item.project === undefined ? "" : ` (project ${item.project})`
      lines.push(`- ${source} ${item.id} [${item.kind}: ${item.state}]${detail}${project}`)
    }
    if (own.length > ROWS_PER_SOURCE) lines.push(`- ${source}: ${own.length - ROWS_PER_SOURCE} more`)
  }
  for (const failed of events.filter((event) => event.kind === "source_failed")) {
    lines.push(`! ${failed.source} could not be read: ${failed.reason ?? "unknown error"}`)
  }
  // A setup-only scan (sessions: false) never read session history, so it states no session count.
  const readSessions = events.some((event) => event.source === "sessions" || event.source === "projects")
  lines.push(`Value summary: ${valueSummary(items.flatMap((event) => (event.item === undefined ? [] : [event.item])), readSessions)}`)
  return lines.join("\n")
}

function valueSummary(rows: readonly OnboardingScanItem[], readSessions: boolean): string {
  const count = (kind: string): number => rows.filter((row) => row.kind === kind).length
  const sessions = count("session")
  const projects = count("project")
  const parts = readSessions
    ? [`${sessions} recent ${sessions === 1 ? "session" : "sessions"} across ${projects} ${projects === 1 ? "project" : "projects"}`]
    : []
  for (const [label, kinds] of SUMMARY_KINDS) {
    const found = rows.filter((row) => kinds.has(row.kind))
    if (found.length === 0) continue
    const carried = found.filter((row) => row.state === "import" || row.state === "login").length
    parts.push(`${found.length} ${label} (${carried} to carry over)`)
  }
  return parts.length === 0 ? "nothing found to carry over." : `${parts.join("; ")}.`
}

const FACT_GROUPS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["sign-ins", new Set(["api-key", "oauth"])],
  ["providers", new Set(["provider"])],
  ["mcp", new Set(["mcp"])],
  ["skills", new Set(["skill"])],
  ["model choices", new Set(["default", "categories", "agents"])],
]

/**
 * The scan's rows as the one-line migration inventory the TUI onboarding injects: ids grouped by
 * category with each row's state, never a key. Undefined when the scan found nothing at all.
 */
export function migrationFactsFromScan(results: readonly SetupStageResult[]): string | undefined {
  const rows = results.flatMap((result) => (result.disabled === true ? [] : [...result.items]))
  if (rows.length === 0) return undefined
  return FACT_GROUPS
    .map(([label, kinds]) => [label, rows.filter((row) => kinds.has(row.kind))] as const)
    .filter(([, own]) => own.length > 0)
    .map(([label, own]) => `${label}: ${own.map((row) => `${row.id} (${row.state}${row.detail === undefined ? "" : ` - ${row.detail}`})`).join(", ")}`)
    .join("; ")
}
