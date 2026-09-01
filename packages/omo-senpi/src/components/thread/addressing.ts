/**
 * Addressing and scope resolution for the thread tool family.
 *
 * Every entry point returns its outcome as data: the error branch is a
 * discriminated `{ kind: "error", ... }` object carrying a taxonomy code and
 * a `next_action` that names thread_list, so a runner hands the failure
 * straight to the model instead of catching (authoring rules R6/R7).
 *
 * Resolution ladder (spec order):
 *   1. An exact durable-id match wins immediately. Scoped callers only see
 *      the hit when it shares their workspace; a hit outside the default
 *      scope is `scope_denied` and never degrades to `not_found`, even when a
 *      same-named thread is visible, because the id already names one thread.
 *   2. Otherwise the target is matched against NFKC-normalized names over the
 *      visible entries: one match resolves as a name, two or more are
 *      `ambiguous_target` with candidates, zero is `not_found`.
 *
 * Workspace scope: two paths share one workspace when they sit inside the
 * same git work tree (canonical `git rev-parse --show-toplevel` equality;
 * linked work trees of one repository count as separate workspaces), and
 * when neither side is in git, when their realpath'd directories are equal.
 * `all_scope: true` widens visibility to every entry the daemon knows.
 */

import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { basename } from "node:path"

import type { ThreadStatus, ThreadSummary } from "./contracts"
import { threadToolFailure, type ThreadErrorCode } from "./errors"

// A thread as the addressing layer sees it: the shared summary plus the
// optional last-message preview the discovery layer may already have loaded.
export type ThreadAddressEntry = ThreadSummary & { readonly preview?: string }

/** The candidate payload every ambiguity error carries (up to ten). */
export type ThreadCandidate = {
  readonly id: string
  readonly name: string
  readonly cwd: string
  readonly preview: string
  readonly updatedAt: string
  readonly state: ThreadStatus
}

/** How a resolveTarget hit was found. */
export type ThreadTargetResolution = "id" | "name"

/** Which fuzzy signal produced the accepted score. */
export type ThreadFuzzyBasis = "name" | "preview" | "cwd"

export type ThreadResolveOptions = {
  /** Address threads in every workspace instead of only the caller's. */
  readonly all_scope?: boolean
  /** The caller's workspace root; required for the default scoped path. */
  readonly callerWorkspaceRoot?: string
}

/** Flat data-error shape: a taxonomy code plus the recovery prompt. */
export type ThreadAddressError = {
  readonly kind: "error"
  readonly code: ThreadErrorCode
  readonly message: string
  readonly next_action: string
  readonly candidates?: readonly ThreadCandidate[]
}

export type ThreadResolveResult =
  | { readonly kind: "ok"; readonly entry: ThreadAddressEntry; readonly resolution: ThreadTargetResolution }
  | ThreadAddressError

export type ThreadFuzzyResult =
  | { readonly kind: "ok"; readonly entry: ThreadAddressEntry; readonly score: number; readonly basis: ThreadFuzzyBasis }
  | ThreadAddressError

export type ThreadNameConflictResult = { readonly kind: "ok" } | ThreadAddressError

const AMBIGUOUS_CANDIDATE_LIMIT = 10
const FUZZY_MIN_QUERY_LENGTH = 3
const FUZZY_MAX_CANDIDATES = 500
const FUZZY_PREVIEW_WEIGHT = 0.85
const FUZZY_CWD_WEIGHT = 0.7
const FUZZY_ACCEPT_SCORE = 0.72
const FUZZY_ACCEPT_MARGIN = 0.08

// C0 control characters that normalization cannot fold away: whitespace
// controls (\t \n \v \f \r) are collapsed by the whitespace pass, the rest is
// garbage an address must never silently match.
const UNFOLDABLE_CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f]/

/**
 * NFKC-normalize, trim, lowercase, and collapse internal whitespace. The
 * single canonical name form used by every comparison in this module, so a
 * composed and a decomposed spelling of the same name are one name.
 */
export function normalizeThreadName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

type Guarded = { readonly ok: true; readonly normalized: string } | { readonly ok: false; readonly error: ThreadAddressError }

function guardInput(value: string, what: string): Guarded {
  if (typeof value !== "string") {
    return { ok: false, error: addressError("invalid_arguments", `The ${what} must be a string.`, `Pass a thread_id or a unique name from thread_list as the ${what}.`) }
  }
  if (UNFOLDABLE_CONTROLS.test(value)) {
    return { ok: false, error: addressError("invalid_arguments", `The ${what} contains control characters.`, `Remove the control characters and retry, or pass an address from thread_list.`) }
  }
  const normalized = normalizeThreadName(value)
  if (normalized.length === 0) {
    return { ok: false, error: addressError("invalid_arguments", `The ${what} is empty.`, `Pass a thread_id or a unique name from thread_list as the ${what}.`) }
  }
  return { ok: true, normalized }
}

// The flat data error is built through the shared failure factory so the code
// stays taxonomy-validated; candidates ride both the top level (the addressing
// contract) and details (the ThreadDataError convention in errors.ts).
function addressError(
  code: ThreadErrorCode,
  message: string,
  nextAction: string,
  candidates?: readonly ThreadCandidate[],
): ThreadAddressError {
  const failure = threadToolFailure(code, message, nextAction, candidates === undefined ? undefined : { candidates })
  return candidates === undefined ? { kind: "error", ...failure } : { kind: "error", ...failure, candidates }
}

function toCandidate(entry: ThreadAddressEntry): ThreadCandidate {
  return {
    id: entry.thread_id,
    name: entry.name,
    cwd: entry.cwd,
    preview: entry.preview ?? "",
    updatedAt: entry.updated_at,
    state: entry.status,
  }
}

// Most recently updated first, thread_id ascending as the deterministic
// tiebreak, capped at the candidate limit.
function toCandidates(matches: readonly ThreadAddressEntry[]): readonly ThreadCandidate[] {
  return [...matches]
    .sort((a, b) =>
      a.updated_at === b.updated_at ? (a.thread_id < b.thread_id ? -1 : 1) : a.updated_at < b.updated_at ? 1 : -1,
    )
    .slice(0, AMBIGUOUS_CANDIDATE_LIMIT)
    .map(toCandidate)
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function gitWorktreeRoot(dir: string): string | null {
  try {
    const output = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
    const trimmed = output.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch {
    return null
  }
}

// One memoized root lookup per resolution call: a 500-entry scope check
// triggers at most one git invocation per distinct cwd.
function makeRootResolver(): (dir: string) => string | null {
  const cache = new Map<string, string | null>()
  return (dir: string) => {
    if (cache.has(dir)) return cache.get(dir) ?? null
    const root = gitWorktreeRoot(dir)
    cache.set(dir, root)
    return root
  }
}

function sameWorkspace(entryCwd: string, callerRoot: string, rootOf: (dir: string) => string | null): boolean {
  const entryRoot = rootOf(entryCwd)
  const callerRootTop = rootOf(callerRoot)
  if (entryRoot !== null && callerRootTop !== null) {
    return canonicalPath(entryRoot) === canonicalPath(callerRootTop)
  }
  return canonicalPath(entryCwd) === canonicalPath(callerRoot)
}

/**
 * Resolve a thread address (durable id or unique name) against the entries
 * the daemon knows, restricted to the caller's workspace unless `all_scope`
 * widens it. Errors come back as data, never throws.
 */
export function resolveTarget(
  entries: readonly ThreadAddressEntry[],
  target: string,
  opts: ThreadResolveOptions = {},
): ThreadResolveResult {
  const guard = guardInput(target, "thread address")
  if (!guard.ok) return guard.error

  const callerRoot = typeof opts.callerWorkspaceRoot === "string" ? opts.callerWorkspaceRoot.trim() : ""
  const hasCallerRoot = callerRoot.length > 0
  const rootResolver = makeRootResolver()

  // Ladder step 1: the exact durable id wins immediately, across every entry.
  const idHit = entries.find((entry) => entry.thread_id === target)
  if (idHit !== undefined) {
    if (opts.all_scope === true) return { kind: "ok", entry: idHit, resolution: "id" }
    if (!hasCallerRoot) {
      return addressError(
        "caller_context_missing",
        "Scoping an id hit needs the caller's workspace root, which this call did not provide.",
        "Set all_scope to address every workspace, or call thread_list from a session that knows its workspace.",
      )
    }
    if (sameWorkspace(idHit.cwd, callerRoot, rootResolver)) {
      return { kind: "ok", entry: idHit, resolution: "id" }
    }
    return addressError(
      "scope_denied",
      `Thread ${idHit.thread_id} exists outside this workspace.`,
      "Call thread_list with all_scope to confirm the id, then retry with all_scope set, or target a thread in this workspace.",
    )
  }

  // Ladder step 2: normalized name match over the visible entries only.
  let visible: readonly ThreadAddressEntry[]
  if (opts.all_scope === true) {
    visible = entries
  } else {
    if (!hasCallerRoot) {
      return addressError(
        "caller_context_missing",
        "Scoped address resolution needs the caller's workspace root, which this call did not provide.",
        "Set all_scope to address every workspace, or call thread_list from a session that knows its workspace.",
      )
    }
    visible = entries.filter((entry) => sameWorkspace(entry.cwd, callerRoot, rootResolver))
  }

  const matches = visible.filter((entry) => normalizeThreadName(entry.name) === guard.normalized)
  if (matches.length === 1) return { kind: "ok", entry: matches[0], resolution: "name" }
  if (matches.length >= 2) {
    return addressError(
      "ambiguous_target",
      `${matches.length} visible threads share the name "${target}".`,
      "Call thread_list and pass the exact thread_id of the intended thread.",
      toCandidates(matches),
    )
  }
  return addressError(
    "not_found",
    `No visible thread matches "${target}" in ${opts.all_scope === true ? "the daemon-wide scope" : "this workspace"}.`,
    "Call thread_list and pass the thread_id or a unique name it returned.",
  )
}

function trigrams(value: string): string[] {
  if (value.length < 3) return []
  const grams: string[] = []
  for (let index = 0; index + 3 <= value.length; index += 1) {
    grams.push(value.slice(index, index + 3))
  }
  return grams
}

// Soerensen-Dice over trigram multisets: twice the shared grams over the
// combined gram count, 0 when either side has no trigrams.
function diceCoefficient(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const counts = new Map<string, number>()
  for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  let shared = 0
  for (const gram of right) {
    const remaining = counts.get(gram) ?? 0
    if (remaining > 0) {
      shared += 1
      counts.set(gram, remaining - 1)
    }
  }
  return (2 * shared) / (left.length + right.length)
}

type ScoredEntry = { entry: ThreadAddressEntry; score: number; basis: ThreadFuzzyBasis }

function scoreEntry(entry: ThreadAddressEntry, queryGrams: readonly string[]): ScoredEntry {
  const nameScore = diceCoefficient(queryGrams, trigrams(normalizeThreadName(entry.name)))
  const preview = typeof entry.preview === "string" ? normalizeThreadName(entry.preview) : ""
  const previewScore = preview === "" ? 0 : FUZZY_PREVIEW_WEIGHT * diceCoefficient(queryGrams, trigrams(preview))
  const cwdScore = FUZZY_CWD_WEIGHT * diceCoefficient(queryGrams, trigrams(normalizeThreadName(basename(entry.cwd))))

  let score = nameScore
  let basis: ThreadFuzzyBasis = "name"
  if (previewScore > score) {
    score = previewScore
    basis = "preview"
  }
  if (cwdScore > score) {
    score = cwdScore
    basis = "cwd"
  }
  return { entry, score, basis }
}

/**
 * Fuzzy-resolve a partial name, transcript preview, or workspace basename via
 * trigram Dice similarity. A leader is accepted only when it scores at least
 * 0.72 and leads its runner-up by at least 0.08; a near tie is
 * ambiguous_target with candidates. Note the weights: an exact cwd-basename
 * match tops out at 0.70 and therefore can never clear the accept floor
 * alone, while a preview term can. Errors come back as data, never throws.
 */
export function fuzzyMatch(entries: readonly ThreadAddressEntry[], query: string): ThreadFuzzyResult {
  const guard = guardInput(query, "fuzzy query")
  if (!guard.ok) return guard.error
  if (guard.normalized.length < FUZZY_MIN_QUERY_LENGTH) {
    return addressError(
      "invalid_arguments",
      `A fuzzy query needs at least ${FUZZY_MIN_QUERY_LENGTH} characters; "${query}" is too short.`,
      "Pass a longer query, or call thread_list and pass the thread_id or a unique name it returned.",
    )
  }
  if (entries.length > FUZZY_MAX_CANDIDATES) {
    return addressError(
      "ambiguous_target",
      `${entries.length} threads are in scope; the fuzzy scan is capped at ${FUZZY_MAX_CANDIDATES}.`,
      "Call thread_list, pick the intended thread, and pass its thread_id instead of a fuzzy query.",
    )
  }
  if (entries.length === 0) {
    return addressError("not_found", "There is no thread to match.", "Call thread_list to see the addressable threads.")
  }

  const queryGrams = trigrams(guard.normalized)
  const scored = entries
    .map((entry) => scoreEntry(entry, queryGrams))
    .sort((a, b) => (a.score === b.score ? (a.entry.thread_id < b.entry.thread_id ? -1 : 1) : b.score - a.score))

  const leader = scored[0]
  const runnerUp = scored[1]?.score ?? 0
  if (leader.score < FUZZY_ACCEPT_SCORE) {
    return addressError(
      "not_found",
      `No thread scored close enough to "${query}" (best ${leader.score.toFixed(3)}).`,
      "Call thread_list and pass the thread_id, or retry with a longer, more distinctive query.",
    )
  }
  if (leader.score - runnerUp < FUZZY_ACCEPT_MARGIN) {
    return addressError(
      "ambiguous_target",
      `Several threads match "${query}" about equally (best ${leader.score.toFixed(3)}, runner-up ${runnerUp.toFixed(3)}).`,
      "Call thread_list and pass the exact thread_id of the intended thread.",
      toCandidates(scored.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).map((candidate) => candidate.entry)),
    )
  }
  return { kind: "ok", entry: leader.entry, score: leader.score, basis: leader.basis }
}

/**
 * Reject a thread_create name that collides, after normalization, with an
 * existing thread. There is no auto-suffix anywhere in this family: the
 * collision surfaces as data so the caller picks a new name or reuses the
 * existing thread by id.
 */
export function checkNameConflict(entries: readonly ThreadSummary[], name: string): ThreadNameConflictResult {
  const guard = guardInput(name, "thread name")
  if (!guard.ok) return guard.error

  const conflict = entries.find((entry) => normalizeThreadName(entry.name) === guard.normalized)
  if (conflict === undefined) return { kind: "ok" }
  return addressError(
    "name_conflict",
    `A thread named "${conflict.name}" (${conflict.thread_id}) already exists.`,
    "Call thread_list to reuse that thread by id, or pass a different name for the new thread.",
    [toCandidate(conflict)],
  )
}
