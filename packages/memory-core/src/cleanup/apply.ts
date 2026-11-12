import { mkdir, readFile, unlink, writeFile } from "../fs/resilient"
import { dirname, join } from "node:path"

import type { GitCommitAuthor, GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { ARCHIVE_PATH, repointLinks, type Successor } from "../reflection/link-rewrite"
import { commitMemoryWrite, type MemoryWriteCommit, type MemoryWriteLock } from "../tools/commit-write"
import type { MemoryToolProvenance } from "../tools/memory"
import { scanCleanupCorpus, type CleanupCorpus, type CleanupNote } from "./corpus"
import { appendMerge, appendToArchive, archiveSection, withConflictMark } from "./edits"
import type { CleanupAction, MemoryCleanupFinding, MemoryCleanupPlan } from "./types"

export interface ApplyMemoryCleanupOptions {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryWriteLock
  readonly plan: MemoryCleanupPlan
  readonly author: GitCommitAuthor
  readonly provenance?: MemoryToolProvenance
}

export type MemoryCleanupApplyResult =
  | { readonly applied: false; readonly reason: "nothing-to-do" }
  | {
      readonly applied: true
      readonly commit: MemoryWriteCommit
      readonly written: readonly string[]
      readonly removed: readonly string[]
    }

/** The repository moved under a plan: a note the plan would write no longer matches what the report described. */
export class MemoryCleanupStaleError extends Error {
  override readonly name = "MemoryCleanupStaleError"
  constructor(readonly changed: readonly string[]) {
    super(
      `memory cleanup: ${changed.length} note(s) changed since the report was written (${changed.join(", ")}); run the dry run again and read it before applying`,
    )
  }
}

export async function applyMemoryCleanup(options: ApplyMemoryCleanupOptions): Promise<MemoryCleanupApplyResult> {
  const { repo, plan } = options
  if (plan.findings.length === 0) return { applied: false, reason: "nothing-to-do" }
  let written: string[] = []
  let removed: string[] = []
  const commit = await commitMemoryWrite({
    repo,
    lock: options.lock,
    author: options.author,
    ...(options.provenance === undefined ? {} : { provenance: options.provenance }),
    writer: "human-command",
    reason: commitMessage(plan),
    successLabel: "memory cleanup",
    apply: async () => {
      const corpus = await scanCleanupCorpus(repo.dir)
      verifySnapshot(plan, corpus)
      const changes = await buildChanges(plan, corpus, repo.dir)
      for (const [path, content] of changes.writes) {
        await mkdir(dirname(join(repo.dir, path)), { recursive: true })
        await writeFile(join(repo.dir, path), content, "utf8")
      }
      for (const path of changes.removals) await unlink(join(repo.dir, path))
      written = [...changes.writes.keys()].sort()
      removed = [...changes.removals].sort()
      return { affectedPaths: [...written, ...removed].sort() }
    },
  })
  return { applied: true, commit, written, removed }
}

function verifySnapshot(plan: MemoryCleanupPlan, corpus: CleanupCorpus): void {
  const changed = Object.entries(plan.snapshot)
    .filter(([path, hash]) => corpus.linking.get(path)?.contentHash !== hash)
    .map(([path]) => path)
  if (changed.length > 0) throw new MemoryCleanupStaleError(changed)
}

interface Changes {
  readonly writes: ReadonlyMap<string, string>
  readonly removals: ReadonlySet<string>
}

async function buildChanges(plan: MemoryCleanupPlan, corpus: CleanupCorpus, repoDir: string): Promise<Changes> {
  const now = Date.parse(plan.generatedAt)
  const current = new Map<string, string>()
  const read = (path: string): string => {
    const content = current.get(path) ?? corpus.notes.get(path)?.content
    if (content === undefined) throw new Error(`memory cleanup: ${path} is not a live note`)
    return content
  }
  const removals = new Set<string>()
  const successors = new Map<string, Successor>()
  const archived: Array<{
    readonly note: CleanupNote
    readonly action: Extract<CleanupAction, { kind: "archive" }>
    readonly finding: MemoryCleanupFinding
  }> = []
  for (const finding of plan.findings) {
    for (const action of finding.actions) {
      switch (action.kind) {
        case "merge":
          current.set(action.into, appendMerge(read(action.into), action, now))
          break
        case "archive": {
          const note = corpus.notes.get(action.path)
          if (note === undefined) throw new Error(`memory cleanup: ${action.path} is not a live note`)
          archived.push({ note, action, finding })
          removals.add(action.path)
          successors.set(
            action.path,
            finding.class === "duplicate" && action.successor !== undefined
              ? { kind: "moved", path: action.successor }
              : { kind: "archived" },
          )
          break
        }
        case "mark-conflict": {
          const content = read(action.path)
          current.set(
            action.path,
            withConflictMark({ content, frontmatter: parseMemoryFile(content).frontmatter }, action.other),
          )
          break
        }
      }
    }
  }
  const live = new Set([...corpus.files].filter((path) => !removals.has(path)))
  if (archived.length > 0) live.add(ARCHIVE_PATH)
  const targets = { live, removed: successors }
  if (archived.length > 0) {
    // An archived body moves to the root, so its relative links are re-resolved from the folder it was written in.
    const sections = archived.map(({ note, action, finding }) =>
      archiveSection(note, repointLinks(ARCHIVE_PATH, note.body, targets, note.path), action, finding, now),
    )
    const existing = corpus.files.has(ARCHIVE_PATH) ? await readFile(join(repoDir, ARCHIVE_PATH), "utf8") : undefined
    current.set(ARCHIVE_PATH, appendToArchive(existing, sections))
  }

  const writes = new Map<string, string>()
  for (const path of [...corpus.linking.keys(), ...(current.has(ARCHIVE_PATH) ? [ARCHIVE_PATH] : [])]) {
    if (removals.has(path)) continue
    const before = current.get(path) ?? corpus.linking.get(path)?.content
    if (before === undefined) continue
    const after = repointLinks(path, before, targets)
    const original = corpus.linking.get(path)?.content
    if (after !== original) writes.set(path, after)
  }
  return { writes, removals }
}

function commitMessage(plan: MemoryCleanupPlan): string {
  const { archive, merge, mark } = plan.summary
  const lines = [`memory cleanup: archive ${archive}, merge ${merge}, mark ${mark}`, ""]
  for (const finding of plan.findings) {
    for (const action of finding.actions) {
      switch (action.kind) {
        case "archive":
          lines.push(`- archived ${action.path}: ${action.reason}`)
          break
        case "merge":
          lines.push(`- merged ${action.paragraphs.length} paragraph(s) from ${action.from} into ${action.into}`)
          break
        case "mark-conflict":
          lines.push(`- marked ${action.path} conflicts_with ${action.other}`)
          break
      }
    }
  }
  return lines.join("\n")
}
