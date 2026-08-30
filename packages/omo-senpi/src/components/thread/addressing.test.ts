import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkNameConflict,
  fuzzyMatch,
  normalizeThreadName,
  resolveTarget,
  type ThreadAddressEntry,
  type ThreadCandidate,
  type ThreadFuzzyResult,
  type ThreadNameConflictResult,
  type ThreadResolveResult,
} from "./addressing"
import type { ThreadErrorCode, ThreadSummary } from "./index"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Virtual paths that exist on no filesystem: git-root resolution fails (git
// -C cannot run there) and realpath falls back to raw-path comparison, so
// "/virtual/caller" is the caller's workspace, "/virtual/other" is a second
// workspace, and neither touches the real disk.
const CALLER = "/virtual/caller"
const OTHER = "/virtual/other"

const TEMP_DIRS: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thread-addressing-"))
  TEMP_DIRS.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true })
})

function thread(partial: Partial<ThreadSummary> & Pick<ThreadSummary, "thread_id">): ThreadAddressEntry {
  return {
    name: `thread-${partial.thread_id}`,
    status: "resumable",
    cwd: CALLER,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    ...partial,
  }
}

type AnyAddressingResult = ThreadResolveResult | ThreadFuzzyResult | ThreadNameConflictResult

function expectError(result: AnyAddressingResult, code: ThreadErrorCode) {
  expect(result.kind).toBe("error")
  if (result.kind !== "error") throw new Error(`expected an error result, got ${result.kind}`)
  expect(result.code).toBe(code)
  expect(result.message.length).toBeGreaterThan(0)
  expect(result.next_action.length).toBeGreaterThan(0)
  return result
}

// ---------------------------------------------------------------------------
// resolveTarget: the exact-address ladder
// ---------------------------------------------------------------------------

describe("resolveTarget exact ladder", () => {
  test("#given a durable thread_id #when resolved in the caller's workspace #then it wins immediately as an id resolution", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "payments" }),
      thread({ thread_id: "t-2", name: "payments lane", cwd: OTHER }),
    ]
    const result = resolveTarget(entries, "t-1", { callerWorkspaceRoot: CALLER })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-1")
    expect(result.resolution).toBe("id")
  })

  test("#given an id that also equals another thread's name #when resolved #then the id hit wins, never the name", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "build" }),
      thread({ thread_id: "build", name: "unrelated" }),
    ]
    const result = resolveTarget(entries, "build", { callerWorkspaceRoot: CALLER })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("build")
    expect(result.resolution).toBe("id")
  })

  test("#given a unique name differing only by case, surrounding space, and internal whitespace #when resolved #then normalization matches it as a name resolution", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "payments lane" }),
      thread({ thread_id: "t-2", name: "renderer" }),
    ]
    const result = resolveTarget(entries, "  Payments\tLANE  ", { callerWorkspaceRoot: CALLER })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-1")
    expect(result.resolution).toBe("name")
  })

  test("#given two visible threads sharing a normalized name #when resolved #then ambiguous_target returns both candidates and never picks one", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "fix build", updated_at: "2026-08-22T10:00:00.000Z" }),
      thread({ thread_id: "t-2", name: "Fix  BUILD", updated_at: "2026-08-23T09:00:00.000Z" }),
    ]
    const result = resolveTarget(entries, "FIX   build", { callerWorkspaceRoot: CALLER })

    const error = expectError(result, "ambiguous_target")
    expect(error.candidates?.length).toBe(2)
    const ids = (error.candidates ?? []).map((candidate) => candidate.id).sort()
    expect(ids).toEqual(["t-1", "t-2"])
  })

  test("#given an ambiguous_target candidate #when inspected #then it is ThreadCandidate-shaped with all six fields", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "fix build" }),
      thread({ thread_id: "t-2", name: "fix  build", updated_at: "2026-08-23T09:00:00.000Z" }),
    ]
    const result = resolveTarget(entries, "fix build", { callerWorkspaceRoot: CALLER })

    const error = expectError(result, "ambiguous_target")
    const candidate: ThreadCandidate | undefined = error.candidates?.[0]
    if (candidate === undefined) throw new Error("expected a candidate")
    expect(Object.keys(candidate).sort()).toEqual(["cwd", "id", "name", "preview", "state", "updatedAt"])
    expect(candidate.id).toBe("t-2") // newest updated_at first
    expect(candidate.name).toBe("fix  build")
    expect(candidate.cwd).toBe(CALLER)
    expect(candidate.preview).toBe("")
    expect(candidate.updatedAt).toBe("2026-08-23T09:00:00.000Z")
    expect(candidate.state).toBe("resumable")
  })

  test("#given twelve visible threads sharing a name #when resolved #then ambiguous_target caps the candidate list at the ten most recently updated", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      thread({
        thread_id: `t-${String(index + 1).padStart(2, "0")}`,
        name: "duplicate lane",
        updated_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    )
    const result = resolveTarget(entries, "duplicate lane", { callerWorkspaceRoot: CALLER })

    const error = expectError(result, "ambiguous_target")
    expect(error.candidates?.length).toBe(10)
    const ids = (error.candidates ?? []).map((candidate) => candidate.id)
    expect(ids).not.toContain("t-01") // two oldest dropped
    expect(ids).not.toContain("t-02")
    expect(ids[0]).toBe("t-12") // newest first
    expect(ids).toContain("t-03")
  })

  test("#given a name that only a thread outside the default scope carries #when resolved #then the answer is not_found because scope_denied is reserved for id hits", () => {
    const entries = [thread({ thread_id: "t-out", name: "ghost lane", cwd: OTHER })]
    const result = resolveTarget(entries, "ghost lane", { callerWorkspaceRoot: CALLER })

    expectError(result, "not_found")
  })

  test("#given no entries at all #when an address is resolved #then it is not_found, never a throw", () => {
    const result = resolveTarget([], "anything", { callerWorkspaceRoot: CALLER })
    expectError(result, "not_found")
  })
})

// ---------------------------------------------------------------------------
// resolveTarget: workspace scope
// ---------------------------------------------------------------------------

describe("resolveTarget workspace scope", () => {
  test("#given an exact id hit outside the caller's workspace #when resolved without all_scope #then it returns scope_denied and never degrades to not_found", () => {
    const entries = [thread({ thread_id: "t-out", name: "payments", cwd: OTHER })]
    const result = resolveTarget(entries, "t-out", { callerWorkspaceRoot: CALLER })

    const error = expectError(result, "scope_denied")
    expect(error.code).not.toBe("not_found")
  })

  test("#given all_scope true #when the same out-of-workspace id and name are resolved #then both widen to the daemon-wide scope", () => {
    const entries = [
      thread({ thread_id: "t-out", name: "payments", cwd: OTHER }),
      thread({ thread_id: "t-2", name: "elsewhere lane", cwd: OTHER }),
    ]

    const byId = resolveTarget(entries, "t-out", { callerWorkspaceRoot: CALLER, all_scope: true })
    expect(byId.kind).toBe("ok")
    if (byId.kind !== "ok") throw new Error("expected ok")
    expect(byId.entry.thread_id).toBe("t-out")
    expect(byId.resolution).toBe("id")

    const byName = resolveTarget(entries, "elsewhere lane", { callerWorkspaceRoot: CALLER, all_scope: true })
    expect(byName.kind).toBe("ok")
    if (byName.kind !== "ok") throw new Error("expected ok")
    expect(byName.entry.thread_id).toBe("t-2")
    expect(byName.resolution).toBe("name")
  })

  test("#given all_scope true without any caller root #when an address is resolved #then the widened scope alone makes every entry visible", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments", cwd: OTHER })]
    const result = resolveTarget(entries, "t-1", { all_scope: true })

    expect(result.kind).toBe("ok")
  })

  test("#given no caller workspace root and no all_scope #when an address is resolved #then the call reports caller_context_missing as data", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments" })]
    expectError(resolveTarget(entries, "t-1", {}), "caller_context_missing")
    expectError(resolveTarget(entries, "payments", {}), "caller_context_missing")
  })

  test("#given a git repository where the entry cwd is a subdirectory of the caller root #when resolved #then the canonical git root makes them one workspace even though the paths differ", () => {
    const repo = makeTempDir()
    execFileSync("git", ["init", "--quiet", repo], { stdio: "ignore" })
    const sub = join(repo, "packages", "app")
    mkdirSync(sub, { recursive: true })

    const entries = [thread({ thread_id: "t-git", name: "payments", cwd: sub })]
    const result = resolveTarget(entries, "t-git", { callerWorkspaceRoot: repo })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-git")
  })

  test("#given two different git repositories #when an id hit lives in the other repo #then it is out of scope", () => {
    const repoA = makeTempDir()
    const repoB = makeTempDir()
    execFileSync("git", ["init", "--quiet", repoA], { stdio: "ignore" })
    execFileSync("git", ["init", "--quiet", repoB], { stdio: "ignore" })
    const subA = join(repoA, "sub")
    mkdirSync(subA)

    const entries = [thread({ thread_id: "t-repo", name: "payments", cwd: subA })]
    const result = resolveTarget(entries, "t-repo", { callerWorkspaceRoot: repoB })

    expectError(result, "scope_denied")
  })

  test("#given a symlinked cwd for a directory that is not a git work tree #when scope is computed #then realpath equality, not raw-path equality, decides visibility", () => {
    const holder = makeTempDir()
    const real = join(holder, "real-workspace")
    const link = join(holder, "link-workspace")
    mkdirSync(real)
    symlinkSync(real, link)

    const entries = [thread({ thread_id: "t-link", name: "payments", cwd: link })]
    const visible = resolveTarget(entries, "t-link", { callerWorkspaceRoot: real })
    expect(visible.kind).toBe("ok")

    const sibling = join(holder, "sibling-workspace")
    mkdirSync(sibling)
    const hidden = resolveTarget(entries, "t-link", { callerWorkspaceRoot: sibling })
    expectError(hidden, "scope_denied")
  })
})

// ---------------------------------------------------------------------------
// resolveTarget: malformed targets
// ---------------------------------------------------------------------------

describe("resolveTarget malformed input", () => {
  const entries = [thread({ thread_id: "t-1", name: "payments" })]

  test("#given an empty string target #when resolved #then it is invalid_arguments data, never a throw", () => {
    expectError(resolveTarget(entries, "", { callerWorkspaceRoot: CALLER }), "invalid_arguments")
  })

  test("#given a whitespace-only target, including NFKC-folded spaces #when resolved #then it is invalid_arguments", () => {
    expectError(resolveTarget(entries, "   \t\n", { callerWorkspaceRoot: CALLER }), "invalid_arguments")
    expectError(resolveTarget(entries, "\u00a0", { callerWorkspaceRoot: CALLER }), "invalid_arguments")
  })

  test("#given a target with embedded control characters #when resolved #then it is invalid_arguments and never matches anything", () => {
    expectError(resolveTarget(entries, "pay\u0007ments", { callerWorkspaceRoot: CALLER }), "invalid_arguments")
    expectError(resolveTarget(entries, "pay\u0000ments", { callerWorkspaceRoot: CALLER }), "invalid_arguments")
  })
})

// ---------------------------------------------------------------------------
// NFKC normalization
// ---------------------------------------------------------------------------

describe("NFKC name normalization", () => {
  test("#given a composed name and a decomposed target #when resolved #then NFKC composition makes them one name", () => {
    const entries = [thread({ thread_id: "t-1", name: "caf\u00e9 lane" })]
    const result = resolveTarget(entries, "cafe\u0301 LANE", { callerWorkspaceRoot: CALLER })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-1")
    expect(result.resolution).toBe("name")
  })

  test("#given a fullwidth latin target and an ascii name #when resolved #then NFKC compatibility folding matches them", () => {
    const entries = [thread({ thread_id: "t-1", name: "build 42" })]
    const result = resolveTarget(entries, "\uFF22UILD 42", { callerWorkspaceRoot: CALLER })

    expect(result.kind).toBe("ok")
  })

  test("#given a composed name and a decomposed duplicate #when resolved #then NFKC also unifies the ambiguity path", () => {
    const entries = [
      thread({ thread_id: "t-1", name: "caf\u00e9" }),
      thread({ thread_id: "t-2", name: "cafe\u0301" }),
    ]
    const result = resolveTarget(entries, "cafe\u0301", { callerWorkspaceRoot: CALLER })

    const error = expectError(result, "ambiguous_target")
    expect(error.candidates?.length).toBe(2)
  })

  test("#given normalizeThreadName #when composed, spaced, and cased input arrives #then it NFKC-normalizes, trims, lowercases, and collapses whitespace", () => {
    expect(normalizeThreadName("  Caf\u00e9\tLANE  ")).toBe("caf\u00e9 lane")
    expect(normalizeThreadName("cafe\u0301")).toBe("caf\u00e9")
    expect(normalizeThreadName("\uFF32UNNER\u3000UP")).toBe("runner up")
  })
})

// ---------------------------------------------------------------------------
// fuzzyMatch: trigram Dice similarity
// ---------------------------------------------------------------------------

describe("fuzzyMatch trigram dice", () => {
  // Fixture scores are hand-computed trigram Dice values; every fixture name
  // is a unique-trigram lowercase ascii run so set and multiset dice agree.
  // q  = "abcdefghijklmnopqrstuv"  (20 trigrams)
  // c1 = "abcdefghijklmnopqwxyza"  (20 trigrams, 15 shared -> 0.75)
  // c2 = "abcdefghijklmnowxyz123"  (20 trigrams, 13 shared -> 0.65)
  const ACCEPT_QUERY = "abcdefghijklmnopqrstuv"

  test("#given a top score of 0.75 with a 0.10 margin #when fuzzy-matched #then the leader is accepted with its score and basis", () => {
    const entries = [
      thread({ thread_id: "t-low", name: "abcdefghijklmnowxyz123", cwd: "/ws/gamma" }),
      thread({ thread_id: "t-win", name: "abcdefghijklmnopqwxyza", cwd: "/ws-beta" }),
    ]
    const result = fuzzyMatch(entries, ACCEPT_QUERY)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-win")
    expect(result.score).toBe(0.75)
    expect(result.basis).toBe("name")
  })

  test("#given a best score of 0.70, under the 0.72 floor #when fuzzy-matched #then it is rejected as not_found", () => {
    // q = "abcdefghijkl" (10 trigrams), c = "abcdefghixyz" (10 trigrams,
    // 7 shared -> dice = 14/20 = 0.70).
    const entries = [thread({ thread_id: "t-70", name: "abcdefghixyz", cwd: "/ws-alpha" })]
    const result = fuzzyMatch(entries, "abcdefghijkl")

    expectError(result, "not_found")
  })

  test("#given a leader at 0.80 with a runner-up at 0.75, a 0.05 margin under the 0.08 bar #when fuzzy-matched #then it is ambiguous_target with both candidates", () => {
    // q  = "abcdefghijkl"    (10 trigrams)
    // c1 = "abcdefghijklmnopq"   (15 trigrams, 10 shared -> 0.80)
    // c2 = "abcdefghijkvwxyz"    (14 trigrams,  9 shared -> 0.75)
    const entries = [
      thread({ thread_id: "t-a", name: "abcdefghijklmnopq", cwd: "/ws-alpha" }),
      thread({ thread_id: "t-b", name: "abcdefghijkvwxyz", cwd: "/ws-beta" }),
    ]
    const result = fuzzyMatch(entries, "abcdefghijkl")

    const error = expectError(result, "ambiguous_target")
    expect(error.candidates?.length).toBe(2)
  })

  test("#given a preview that matches the query exactly while the name does not #when fuzzy-matched #then the preview term accepts at its 0.85 weight", () => {
    const entries: ThreadAddressEntry[] = [
      { ...thread({ thread_id: "t-prev", name: "misc notes", cwd: "/ws/one" }), preview: "payments migration" },
      thread({ thread_id: "t-other", name: "renderer", cwd: "/ws/two" }),
    ]
    const result = fuzzyMatch(entries, "payments migration")

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-prev")
    expect(result.score).toBe(0.85)
    expect(result.basis).toBe("preview")
  })

  test("#given only a cwd basename equal to the query #when fuzzy-matched #then the 0.70 weighted term stays under the 0.72 floor and cannot accept alone", () => {
    const entries = [thread({ thread_id: "t-cwd", name: "zzz", cwd: "/ws/payments" })]
    const result = fuzzyMatch(entries, "payments")

    expectError(result, "not_found")
  })

  test("#given a query of exactly three normalized characters #when fuzzy-matched against an identical name #then it still accepts at score 1", () => {
    const entries = [thread({ thread_id: "t-3", name: "abc" })]
    const result = fuzzyMatch(entries, " ABC ")

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.score).toBe(1)
    expect(result.basis).toBe("name")
  })

  test("#given queries shorter than three normalized characters #when fuzzy-matched #then they are rejected as invalid_arguments data", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments" })]
    expectError(fuzzyMatch(entries, "ab"), "invalid_arguments")
    expectError(fuzzyMatch(entries, "a"), "invalid_arguments")
    expectError(fuzzyMatch(entries, "  "), "invalid_arguments")
    expectError(fuzzyMatch(entries, ""), "invalid_arguments")
  })

  test("#given a query with control characters #when fuzzy-matched #then it is invalid_arguments, never a throw", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments" })]
    expectError(fuzzyMatch(entries, "pay\u0007ments"), "invalid_arguments")
  })

  test("#given no entries #when fuzzy-matched #then it is not_found, never a throw", () => {
    expectError(fuzzyMatch([], "payments"), "not_found")
  })
})

// ---------------------------------------------------------------------------
// fuzzyMatch: scan cap
// ---------------------------------------------------------------------------

describe("fuzzyMatch scan cap", () => {
  function noise(count: number): ThreadAddressEntry[] {
    return Array.from({ length: count }, (_, index) => thread({ thread_id: `t-${index}`, name: `noise-${index}` }))
  }

  test("#given 501 candidate threads #when fuzzy-matched #then the scan cap returns an ambiguous_target narrowing error before any scoring", () => {
    const result = fuzzyMatch(noise(501), "payments")
    const error = expectError(result, "ambiguous_target")
    expect(error.message).toContain("501")
    expect(error.candidates).toBeUndefined()
  })

  test("#given exactly 500 candidate threads #when fuzzy-matched #then the boundary scans and still resolves a clear leader", () => {
    const entries = [...noise(499), thread({ thread_id: "t-hit", name: "target-name" })]
    const result = fuzzyMatch(entries, "target-name")

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.entry.thread_id).toBe("t-hit")
  })
})

// ---------------------------------------------------------------------------
// checkNameConflict: no auto-suffix on collision
// ---------------------------------------------------------------------------

describe("checkNameConflict", () => {
  test("#given a name no visible thread uses #when checked #then it is ok", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments lane" })]
    expect(checkNameConflict(entries, "fresh-lane")).toEqual({ kind: "ok" })
  })

  test("#given a name colliding after normalization #when checked #then it returns name_conflict data with the conflicting candidate, never an auto-suffix", () => {
    const entries = [thread({ thread_id: "t-1", name: "Payments Lane" })]
    const result = checkNameConflict(entries, "payments   lane")

    const error = expectError(result, "name_conflict")
    expect(error.candidates?.[0]?.id).toBe("t-1")
  })

  test("#given a decomposed name colliding with a composed stored name #when checked #then NFKC unifies them into a name_conflict", () => {
    const entries = [thread({ thread_id: "t-1", name: "caf\u00e9" })]
    expectError(checkNameConflict(entries, "cafe\u0301"), "name_conflict")
  })

  test("#given an empty, whitespace-only, or control-character name #when checked #then it is invalid_arguments, never ok", () => {
    const entries = [thread({ thread_id: "t-1", name: "payments" })]
    expectError(checkNameConflict(entries, ""), "invalid_arguments")
    expectError(checkNameConflict(entries, "   "), "invalid_arguments")
    expectError(checkNameConflict(entries, "bad\u0007name"), "invalid_arguments")
  })

  test("#given an empty entry list #when a name is checked #then any well-formed name is ok", () => {
    expect(checkNameConflict([], "first-lane")).toEqual({ kind: "ok" })
  })
})

// ---------------------------------------------------------------------------
// R7: every error names the recovery path
// ---------------------------------------------------------------------------

describe("error recovery wording (R7)", () => {
  test("#given every error this module can return #when inspected #then each next_action names thread_list", () => {
    const dupes = [
      thread({ thread_id: "t-1", name: "fix build" }),
      thread({ thread_id: "t-2", name: "fix  build" }),
    ]
    const errors: AnyAddressingResult[] = [
      resolveTarget([thread({ thread_id: "t-1", name: "payments" })], "missing", { callerWorkspaceRoot: CALLER }),
      resolveTarget(dupes, "fix build", { callerWorkspaceRoot: CALLER }),
      resolveTarget([thread({ thread_id: "t-1", name: "ghost", cwd: OTHER })], "t-1", { callerWorkspaceRoot: CALLER }),
      resolveTarget([thread({ thread_id: "t-1", name: "payments" })], "", { callerWorkspaceRoot: CALLER }),
      resolveTarget([thread({ thread_id: "t-1", name: "payments" })], "payments", {}),
      fuzzyMatch([thread({ thread_id: "t-1", name: "payments" })], "ab"),
      fuzzyMatch([thread({ thread_id: "t-1", name: "payments" })], "zzzzz"),
      fuzzyMatch(Array.from({ length: 501 }, (_, i) => thread({ thread_id: `t-${i}`, name: `noise-${i}` })), "payments"),
      checkNameConflict([thread({ thread_id: "t-1", name: "payments" })], "payments"),
    ]

    expect(errors.length).toBe(9)
    for (const result of errors) {
      expect(result.kind).toBe("error")
      if (result.kind !== "error") throw new Error("expected error")
      expect(result.next_action, result.code).toContain("thread_list")
    }
  })
})
