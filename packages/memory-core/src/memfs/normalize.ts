import { readFile, readFileSync, writeFile, writeFileSync } from "../fs/resilient"
import { join } from "node:path"
import { createNodeGitExec, type GitCommitAuthor, type GitExec, type GitMemoryRepo } from "../git"
import { decodeScalarSource } from "./frontmatter-scalar"
import { describeFrontmatterGrammarViolation } from "./frontmatter-validation"
import { parseMemoryFile, renderMemoryFile, type MemoryFrontmatter, type ParsedMemoryFile } from "./frontmatter"
import { resolveCommonGitDir } from "./hooks"
import { isMemoryContentPath } from "./paths"

export const FRONTMATTER_NORMALIZATION_MARKER = "omo-memory-frontmatter-normalized"
export const FRONTMATTER_NORMALIZATION_SUBJECT = "chore(memory): normalize frontmatter to strict YAML"

const GIT_TIMEOUT_MS = 30_000

export interface NormalizeFrontmatterSkip {
  readonly path: string
  readonly reason: "read_only" | "unparseable" | "not_reproducible"
}

export type NormalizeFrontmatterResult =
  | { readonly status: "clean"; readonly examined: number; readonly rewritten: readonly string[]; readonly skipped: readonly NormalizeFrontmatterSkip[] }
  | { readonly status: "normalized"; readonly sha: string; readonly examined: number; readonly rewritten: readonly string[]; readonly skipped: readonly NormalizeFrontmatterSkip[] }
  | { readonly status: "skipped"; readonly detail: string; readonly examined: 0; readonly rewritten: readonly string[]; readonly skipped: readonly NormalizeFrontmatterSkip[] }

/**
 * One-time, idempotent repair of legacy frontmatter: every memory content file
 * whose header a strict YAML consumer would reject (or read differently from
 * the memory reader) is re-rendered through `renderMemoryFile` and committed
 * once. A marker in the common git dir records the HEAD that was checked, so
 * later runs only examine files changed since then. Content is never altered:
 * a rewrite is kept only when it parses back to the same description and body.
 */
export async function normalizeMemoryFrontmatter(
  repo: GitMemoryRepo,
  author: GitCommitAuthor,
  exec: GitExec = createNodeGitExec(),
): Promise<NormalizeFrontmatterResult> {
  const head = await repo.head()
  if (head === null) return { status: "clean", examined: 0, rewritten: [], skipped: [] }

  const markerPath = markerPathFor(repo)
  const checkedSha = readMarker(markerPath)
  if (checkedSha === head) return { status: "clean", examined: 0, rewritten: [], skipped: [] }

  if ((await repo.status()).trim().length > 0) {
    return {
      status: "skipped",
      detail: "memory repository working tree is dirty; frontmatter normalization deferred to the next clean session",
      examined: 0,
      rewritten: [],
      skipped: [],
    }
  }

  const candidates = await candidatePaths(repo, exec, checkedSha, head)
  const rewritten: string[] = []
  const skipped: NormalizeFrontmatterSkip[] = []
  for (const path of candidates) {
    const outcome = await normalizeOne(repo.dir, path)
    if (outcome === "unchanged") continue
    if (outcome === "rewritten") rewritten.push(path)
    else skipped.push({ path, reason: outcome })
  }

  if (rewritten.length === 0) {
    writeMarker(markerPath, head)
    return { status: "clean", examined: candidates.length, rewritten, skipped }
  }

  const commit = await repo.commitWrite(
    rewritten,
    `${FRONTMATTER_NORMALIZATION_SUBJECT} (${rewritten.length} ${rewritten.length === 1 ? "file" : "files"})`,
    author,
  )
  writeMarker(markerPath, commit.sha)
  return { status: "normalized", sha: commit.sha, examined: candidates.length, rewritten, skipped }
}

/** Lock-free pre-check: true when HEAD moved past the last recorded normalization pass (or none was recorded). */
export async function frontmatterNormalizationPending(repo: GitMemoryRepo): Promise<boolean> {
  const head = await repo.head()
  return head !== null && readMarker(markerPathFor(repo)) !== head
}

function markerPathFor(repo: GitMemoryRepo): string {
  return join(resolveCommonGitDir(repo.dir), FRONTMATTER_NORMALIZATION_MARKER)
}

async function normalizeOne(root: string, path: string): Promise<"unchanged" | "rewritten" | NormalizeFrontmatterSkip["reason"]> {
  const absolute = join(root, path)
  const content = await readFile(absolute, "utf8")
  if (describeFrontmatterGrammarViolation(content) === null) return "unchanged"

  let parsed: ParsedMemoryFile
  try {
    parsed = parseMemoryFile(content)
  } catch {
    return "unparseable"
  }
  if (parsed.frontmatter.read_only === "true") return "read_only"

  let rendered: string
  try {
    rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
  } catch {
    return "unparseable"
  }
  if (describeFrontmatterGrammarViolation(rendered) !== null || !sameMemoryFile(parseMemoryFile(rendered), parsed)) {
    return "not_reproducible"
  }

  await writeFile(absolute, rendered, "utf8")
  return "rewritten"
}

function sameMemoryFile(a: ParsedMemoryFile, b: ParsedMemoryFile): boolean {
  return a.body === b.body && sameFrontmatter(a.frontmatter, b.frontmatter)
}

function sameFrontmatter(a: MemoryFrontmatter, b: MemoryFrontmatter): boolean {
  if (a.description !== b.description || a.read_only !== b.read_only || a.kind !== b.kind) return false
  if (JSON.stringify(a.aliases) !== JSON.stringify(b.aliases)) return false
  const aExtra = a.extra ?? {}
  const bExtra = b.extra ?? {}
  const keys = Object.keys(aExtra)
  if (keys.length !== Object.keys(bExtra).length) return false
  return keys.every((key) => {
    const other = bExtra[key]
    return other !== undefined && decodeScalarSource(aExtra[key] ?? "") === decodeScalarSource(other)
  })
}

async function candidatePaths(
  repo: GitMemoryRepo,
  exec: GitExec,
  checkedSha: string | null,
  head: string,
): Promise<readonly string[]> {
  const changed = checkedSha === null ? null : await changedSince(exec, repo.dir, checkedSha, head)
  const paths = changed ?? (await repo.lsTree(head))
  return paths.filter(isMemoryContentPath)
}

async function changedSince(exec: GitExec, cwd: string, from: string, to: string): Promise<readonly string[] | null> {
  const result = await exec.run(["diff", "--name-only", "-z", "--diff-filter=ACMR", from, to, "--"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  if (result.code !== 0) return null
  return result.stdout.split("\0").filter(Boolean)
}

function readMarker(markerPath: string): string | null {
  try {
    const sha = readFileSync(markerPath, "utf8").trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

function writeMarker(markerPath: string, sha: string): void {
  writeFileSync(markerPath, `${sha}\n`, "utf8")
}
