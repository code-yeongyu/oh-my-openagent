import { ARCHIVE_PATH } from "../reflection/link-rewrite"
import { findConflicts } from "./conflicts"
import { scanCleanupCorpus, type CleanupCorpus } from "./corpus"
import { readDeclarations } from "./declarations"
import { findDuplicates } from "./duplicates"
import { mergeSectionBytes, markLineBytes } from "./edits"
import { findStale } from "./staleness"
import { findSuperseded } from "./supersession"
import {
  LOAD_BEARING_PATHS,
  resolveCleanupOptions,
  type CleanupAction,
  type HeldFinding,
  type KeptNote,
  type MemoryCleanupBudget,
  type MemoryCleanupFinding,
  type MemoryCleanupOptions,
  type MemoryCleanupPlan,
  type ResolvedCleanupOptions,
} from "./types"

type Draft = Omit<MemoryCleanupFinding, "id" | "touches">

export async function planMemoryCleanup(
  repoDir: string,
  options: MemoryCleanupOptions = {},
): Promise<MemoryCleanupPlan> {
  const resolved = resolveCleanupOptions(options)
  const corpus = await scanCleanupCorpus(repoDir)
  const declarations = readDeclarations(corpus)
  const only = new Set(resolved.only)
  const skip = new Set(resolved.skip)
  const kept: KeptNote[] = []
  const claimed = new Set<string>()
  const drafts: Draft[] = []

  const consider = (draft: Draft): void => {
    const vetoed = [draft.subject, draft.related].filter((path): path is string => path !== undefined && skip.has(path))
    if (vetoed.length > 0) {
      kept.push({
        kind: "skipped-by-option",
        detail: `${draft.class} ${draft.subject}: ${vetoed.join(", ")} listed in --skip`,
        paths: vetoed,
      })
      return
    }
    const archives = draft.actions.filter((action) => action.kind === "archive").map((action) => action.path)
    if (archives.some((path) => claimed.has(path))) return
    for (const path of archives) claimed.add(path)
    drafts.push(draft)
  }

  const supersession = findSuperseded(corpus, declarations, resolved.containment)
  if (only.has("superseded")) {
    for (const candidate of supersession.candidates) {
      consider({
        class: "superseded",
        subject: candidate.subject,
        related: candidate.successor,
        evidence: candidate.evidence,
        actions: [
          {
            kind: "archive",
            path: candidate.subject,
            reason: `superseded by ${candidate.successor}`,
            successor: candidate.successor,
          },
        ],
      })
    }
    kept.push(...supersession.kept)
  }
  if (only.has("stale")) {
    for (const candidate of findStale(corpus, resolved.now)) {
      consider({
        class: "stale",
        subject: candidate.subject,
        evidence: candidate.evidence,
        actions: [
          {
            kind: "archive",
            path: candidate.subject,
            reason: `stale: ${candidate.evidence.map((item) => item.detail).join("; ")}`,
          },
        ],
      })
    }
  }
  if (only.has("duplicate")) {
    for (const candidate of findDuplicates(corpus, resolved.similarity, claimed)) {
      const merge: CleanupAction[] =
        candidate.distinctive.length === 0
          ? []
          : [{ kind: "merge", into: candidate.canonical, from: candidate.subject, paragraphs: candidate.distinctive }]
      consider({
        class: "duplicate",
        subject: candidate.subject,
        related: candidate.canonical,
        evidence: candidate.evidence,
        actions: [
          ...merge,
          {
            kind: "archive",
            path: candidate.subject,
            reason: `duplicate of ${candidate.canonical}`,
            successor: candidate.canonical,
          },
        ],
      })
    }
  }
  if (only.has("conflict")) {
    const conflicts = findConflicts(corpus, declarations, supersession.mutual, claimed)
    for (const candidate of conflicts.candidates) {
      consider({
        class: "conflict",
        subject: candidate.a,
        related: candidate.b,
        evidence: candidate.evidence,
        actions: candidate.marks.map((path) => ({
          kind: "mark-conflict",
          path,
          other: path === candidate.a ? candidate.b : candidate.a,
        })),
      })
    }
    kept.push(...conflicts.kept)
  }

  const findings: MemoryCleanupFinding[] = []
  const held: HeldFinding[] = []
  for (const draft of drafts) {
    const touches = touchedPaths(draft, corpus)
    const finding = {
      ...draft,
      id: `${draft.class}:${draft.subject}${draft.related === undefined ? "" : `:${draft.related}`}`,
      touches,
    }
    const reason = holdReason(finding, corpus, resolved)
    if (reason === undefined) findings.push(finding)
    else held.push({ ...finding, held: reason })
  }
  const order = { superseded: 0, stale: 1, duplicate: 2, conflict: 3 } as const
  const byClass = (a: MemoryCleanupFinding, b: MemoryCleanupFinding): number =>
    order[a.class] - order[b.class] || a.subject.localeCompare(b.subject)
  findings.sort(byClass)
  held.sort(byClass)

  const snapshot: Record<string, string> = {}
  for (const path of findings.flatMap((finding) => finding.touches)) {
    const note = corpus.notes.get(path)
    if (note !== undefined) snapshot[path] = note.contentHash
  }
  return {
    version: 1,
    repoDir,
    generatedAt: new Date(resolved.now).toISOString(),
    options: resolved,
    scanned: { notes: corpus.notes.size, byHome: countByHome(corpus), skipped: corpus.skipped },
    findings,
    held,
    kept,
    budget: budgetOf(corpus, findings, resolved),
    summary: {
      archive: findings.flatMap((finding) => finding.actions).filter((action) => action.kind === "archive").length,
      merge: findings.flatMap((finding) => finding.actions).filter((action) => action.kind === "merge").length,
      mark: findings.flatMap((finding) => finding.actions).filter((action) => action.kind === "mark-conflict").length,
      repoint: new Set(findings.flatMap((finding) => finding.touches.filter((path) => !ownedBy(finding, path)))).size,
    },
    snapshot,
  }
}

/** Paths an action writes directly, as opposed to notes touched only because a link inside them is repointed. */
function ownedBy(finding: MemoryCleanupFinding, path: string): boolean {
  return path === ARCHIVE_PATH || finding.actions.some((action) => writtenPath(action) === path)
}

function writtenPath(action: CleanupAction): string {
  switch (action.kind) {
    case "archive":
      return action.path
    case "merge":
      return action.into
    case "mark-conflict":
      return action.path
  }
}

function touchedPaths(draft: Draft, corpus: CleanupCorpus): string[] {
  const touched = new Set<string>()
  for (const action of draft.actions) {
    switch (action.kind) {
      case "archive":
        touched.add(action.path)
        touched.add(ARCHIVE_PATH)
        for (const source of corpus.inbound.get(action.path) ?? []) touched.add(source)
        break
      case "merge":
        touched.add(action.into)
        break
      case "mark-conflict":
        touched.add(action.path)
        break
    }
  }
  return [...touched].sort()
}

function holdReason(
  finding: MemoryCleanupFinding,
  corpus: CleanupCorpus,
  options: ResolvedCleanupOptions,
): string | undefined {
  for (const path of finding.touches) {
    const note = corpus.notes.get(path)
    const role = ownedBy(finding, path) ? "would write" : "would repoint a link in"
    if (note?.readOnly === true) return `${role} ${path}, which is read_only`
    if (!options.includeLoadBearing && LOAD_BEARING_PATHS.has(path))
      return `${role} ${path} (load-bearing; pass --include-load-bearing)`
  }
  return undefined
}

function countByHome(corpus: CleanupCorpus): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const path of corpus.notes.keys()) {
    const home = path.split("/")[0] ?? ""
    counts[home] = (counts[home] ?? 0) + 1
  }
  return counts
}

const tokensOf = (bytes: number): number => Math.ceil(bytes / 4)

function budgetOf(
  corpus: CleanupCorpus,
  findings: readonly MemoryCleanupFinding[],
  options: ResolvedCleanupOptions,
): MemoryCleanupBudget {
  const systemNotes = [...corpus.notes.values()].filter((note) => note.path.startsWith("system/"))
  const before = systemNotes.reduce((sum, note) => sum + tokensOf(note.bytes), 0)
  let after = before
  for (const action of findings.flatMap((finding) => finding.actions)) {
    switch (action.kind) {
      case "archive":
        if (action.path.startsWith("system/")) after -= tokensOf(corpus.notes.get(action.path)?.bytes ?? 0)
        break
      case "merge":
        if (action.into.startsWith("system/")) after += tokensOf(mergeSectionBytes(action, options.now))
        break
      case "mark-conflict":
        if (action.path.startsWith("system/")) after += tokensOf(markLineBytes(action.other))
        break
    }
  }
  return {
    systemFiles: systemNotes.length,
    tokensBefore: before,
    tokensAfter: after,
    ...(options.budgetTokens === undefined ? {} : { budgetTokens: options.budgetTokens }),
  }
}
