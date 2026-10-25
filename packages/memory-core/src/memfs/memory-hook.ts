import { readFileSync } from "../fs/resilient"
import { PROVENANCE_FRONTMATTER_KEY, stampReceipt } from "../tools/claim-frontmatter"
import { parseMemoryFile } from "./frontmatter"
import { contentFrontmatterEntries, duplicateFrontmatterKeys, lookAlikeFrontmatterKeys } from "./frontmatter-entries"
import { mergeHeads, readBlob, stagedEntries, treeBlob, type StagedEntry } from "./memory-hook-git"

export type MemoryHookStage = "pre-commit" | "commit-msg"
export { parseRawZ, type StagedEntry } from "./memory-hook-git"

const MEMORY_WRITER_TRAILER = /^Omo-Writer: memory-tool$/m
// git quotes a path holding any of these even with core.quotePath=false, and the shell checks read
// git's newline-separated lists; refusing such names keeps every list the shell sees exact.
const GIT_QUOTED_PATH = /["\\\u0000-\u001f\u007f]/
const REGULAR_FILE_MODES = new Set(["100644", "100755"])
const RECEIPT_REFUSAL = "the provenance header is a claim receipt only the memory tool writes; remove that line (or save the note with the memory tool)"

// The value the reader would take for the header: the last `provenance` entry of the frontmatter,
// read by the same entry reader parseMemoryFile uses.
export function provenanceOf(content: string | undefined): string | undefined {
  if (content === undefined) return undefined
  return contentFrontmatterEntries(content)?.filter((entry) => entry.key === PROVENANCE_FRONTMATTER_KEY).at(-1)?.value
}

// Every staged entry is inspected, whatever its change type (A C D M R T U X) or path: a deletion is
// fine; anything else must be a regular-file blob, so a type change, symlink or submodule can never
// carry content around the receipt checks.
export function preCommitFailures(cwd: string, entries: readonly StagedEntry[] = stagedEntries(cwd)): string[] {
  const failures: string[] = []
  for (const { status, path, dstBlob, dstMode } of entries) {
    if (GIT_QUOTED_PATH.test(path)) {
      failures.push(`  ${JSON.stringify(path)}: memory file names cannot hold quotes, backslashes or control characters; rename it`)
      continue
    }
    if (status.startsWith("D")) continue
    if (!REGULAR_FILE_MODES.has(dstMode)) {
      failures.push(`  ${path}: a memory file must be a regular file (not a symbolic link, submodule or unknown type, git status ${status}); commit the file itself`)
      continue
    }
    const staged = readBlob(cwd, dstBlob)
    if (staged === undefined) {
      failures.push(`  ${path}: the staged file could not be read`)
      continue
    }
    failures.push(...lookAlikeFailures(path, staged))
    if (!path.endsWith(".md") && provenanceOf(staged) === undefined) continue
    for (const key of duplicateFrontmatterKeys(staged)) failures.push(`  ${path}: duplicate frontmatter key '${key}'; keep one`)
  }
  return failures
}

// A key that reads as `provenance` but is not spelled exactly so (`Provenance`, `"provenance"`) is refused on every
// path and for every writer, the memory tool included: its restamp never writes one, so only a forgery carries it.
function lookAlikeFailures(path: string, staged: string): string[] {
  return lookAlikeFrontmatterKeys(staged, PROVENANCE_FRONTMATTER_KEY).map((key) =>
    `  ${path}: frontmatter key '${key}' reads as '${PROVENANCE_FRONTMATTER_KEY}'; only the memory tool writes that key, spelled exactly`)
}

export function commitMessageFailures(cwd: string, message: string, entries: readonly StagedEntry[] = stagedEntries(cwd)): string[] {
  if (MEMORY_WRITER_TRAILER.test(message)) return entries.flatMap((entry) => {
    if (entry.status.startsWith("D") || !REGULAR_FILE_MODES.has(entry.dstMode)) return []
    const staged = readBlob(cwd, entry.dstBlob)
    return staged === undefined ? [`  ${entry.path}: the staged file could not be read`] : lookAlikeFailures(entry.path, staged)
  })
  const heads = mergeHeads(cwd)
  const failures: string[] = []
  for (const entry of entries) {
    if (entry.status.startsWith("D")) continue
    if (!REGULAR_FILE_MODES.has(entry.dstMode)) {
      failures.push(`  ${entry.path}: a memory file must be a regular file (not a symbolic link, submodule or unknown type, git status ${entry.status})`)
      continue
    }
    const staged = readBlob(cwd, entry.dstBlob)
    if (staged === undefined) {
      failures.push(`  ${entry.path}: the staged file could not be read`)
      continue
    }
    failures.push(...lookAlikeFailures(entry.path, staged))
    const header = provenanceOf(staged)
    if (header !== undefined && !handCommitKeeps(cwd, entry, staged, header, heads)) failures.push(`  ${entry.path}: ${RECEIPT_REFUSAL}`)
  }
  return failures
}

// A hand commit (a merge included) leaves a note exactly as a parent has it, or writes the header the
// memory tool would write for an unverified edit of that parent: a user header becomes "mixed", an
// agent header stays, a new note gets none. A body merged from two sides was never approved as one.
function handCommitKeeps(cwd: string, entry: StagedEntry, staged: string, header: string, heads: readonly string[]): boolean {
  const ours = entry.status.startsWith("M") || entry.status.startsWith("R") ? readBlob(cwd, entry.srcBlob) : undefined
  const theirs = heads.map((head) => readBlob(cwd, treeBlob(cwd, head, entry.path)))
  return [ours, ...theirs].some((parent) => parent !== undefined && (parent === staged || lowered(parent, staged) === header))
}

function lowered(parent: string, staged: string): string | undefined {
  try {
    const next = parseMemoryFile(staged)
    return stampReceipt(parseMemoryFile(parent), next.frontmatter, next.body, undefined).extra?.[PROVENANCE_FRONTMATTER_KEY]
  } catch {
    return undefined
  }
}

// Entry for the memory hooks: `<runtime> <script> --memory-hook <stage> [message file]`, run by git in
// the repository root. Prints the refusals and returns the exit code.
export function runMemoryHook(args: readonly string[], cwd: string): number {
  const [stage, messageFile] = args
  const failures = stage === "pre-commit"
    ? preCommitFailures(cwd)
    : stage === "commit-msg" && messageFile !== undefined
      ? commitMessageFailures(cwd, readFileSync(messageFile, "utf8"))
      : [`  memory hook: unknown stage ${JSON.stringify(stage)}`]
  if (failures.length === 0) return 0
  process.stdout.write(`${stage === "commit-msg" ? "Claim receipt validation failed:" : "Frontmatter validation failed:"}\n${failures.join("\n")}\n`)
  return 1
}
