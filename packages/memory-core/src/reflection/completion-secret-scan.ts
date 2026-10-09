import type { GitExecResult } from "../git"
import { redactSecretLikeMaterial, scanSecretLikeMaterial } from "../sync/redact"

export type CompletionGitRun = (argv: readonly string[], stdin?: string) => Promise<GitExecResult>

interface DiffTreeRecord {
  readonly dstMode: string
  readonly dstSha: string
  readonly path: string
}

const SCANNED_BLOB_MODES = new Set(["100644", "100755", "120000"])
const SUBMODULE_MODE = "160000"
const ZERO_SHA = /^0+$/

/**
 * The last gate before a worktree tip is merged --no-ff into the memory repo: every file
 * version the run's commits introduce is screened, not only the tip, because the merge
 * carries the whole branch history. Paths are scanned first (a file name is
 * repository-controlled text like any body), then every blob's full content regardless of
 * extension. A blob already reachable from the base is still scanned when the branch
 * re-introduces it, and a non-UTF-8 blob is scanned as latin1 so a binary cannot smuggle
 * an ASCII credential. The refusal names the earliest introducing commit and never the
 * matched text.
 */
export async function findSecretLikeFailure(
  run: CompletionGitRun,
  baseSha: string,
  tipSha: string,
): Promise<string | null> {
  const revList = await run(["rev-list", "--reverse", `${baseSha}..${tipSha}`])
  if (revList.code !== 0) throw new Error(revList.stderr.trim() || "git rev-list failed")
  for (const commit of revList.stdout.split(/\r?\n/).filter(Boolean)) {
    const failure = await findCommitSecretFailure(run, commit)
    if (failure !== null) return failure
  }
  return null
}

async function findCommitSecretFailure(run: CompletionGitRun, commit: string): Promise<string | null> {
  const records = await listCommitFileVersions(run, commit)
  const submodule = records.find((record) => record.dstMode === SUBMODULE_MODE)
  if (submodule !== undefined) return `secret_like_content: ${redactSecretLikeMaterial(submodule.path)} (submodule, file type)`
  const introduced = records.filter((record) => !ZERO_SHA.test(record.dstSha))
  for (const record of introduced) {
    const hit = scanSecretLikeMaterial(record.path)[0]
    if (hit !== undefined) {
      return `secret_like_content: ${redactSecretLikeMaterial(record.path)} (${hit.class}, file name) @${commit.slice(0, 7)}`
    }
  }
  const blobRecords = introduced.filter((record) => SCANNED_BLOB_MODES.has(record.dstMode))
  const blobs = await readBlobContents(run, blobRecords.map((record) => record.dstSha))
  for (const record of blobRecords) {
    const content = blobs.get(record.dstSha)
    if (content === undefined) continue
    const hit = scanSecretLikeMaterial(content)[0]
    if (hit !== undefined) return `secret_like_content: ${record.path} (${hit.class}) @${commit.slice(0, 7)}`
  }
  return null
}

/**
 * Every file version one commit introduces, against EACH parent for merges (`-m`), including
 * type changes (`T`) whose destination blob is a new file version too - a symlink target is a
 * blob and can carry an evaded credential.
 */
async function listCommitFileVersions(run: CompletionGitRun, commit: string): Promise<DiffTreeRecord[]> {
  const result = await run([
    "diff-tree", "-r", "-m", "--no-commit-id", "--no-renames", "--diff-filter=AMT", "--raw", "-z", commit,
  ])
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff-tree failed")
  const parts = result.stdout.split("\0")
  const records: DiffTreeRecord[] = []
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const header = parts[index]
    const path = parts[index + 1]
    if (header === undefined || path === undefined || path.length === 0 || !header.startsWith(":")) continue
    const fields = header.slice(1).split(" ")
    if (fields.length < 5) continue
    const [, dstMode, , dstSha] = fields
    if (dstMode === undefined || dstSha === undefined) continue
    records.push({ dstMode, dstSha, path })
  }
  return records
}

async function readBlobContents(run: CompletionGitRun, oids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(oids)]
  if (unique.length === 0) return new Map()
  const result = await run(["cat-file", "--batch"], `${unique.join("\n")}\n`)
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git cat-file --batch failed")
  return parseBlobBodies(result.stdoutBytes ?? Buffer.from(result.stdout, "utf8"))
}

function parseBlobBodies(output: Buffer): Map<string, string> {
  const blobs = new Map<string, string>()
  const utf8 = new TextDecoder("utf-8", { fatal: true })
  let offset = 0
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset)
    if (newline === -1) throw new Error("git cat-file --batch output ended inside a record header")
    const header = output.toString("utf8", offset, newline)
    offset = newline + 1
    const [oid, type, sizeText] = header.split(" ")
    if (sizeText === undefined) continue
    const size = Number.parseInt(sizeText, 10)
    if (oid === undefined || !Number.isSafeInteger(size) || size < 0 || offset + size > output.length) {
      throw new Error(`git cat-file --batch output is malformed at "${header}"`)
    }
    if (type === "blob") blobs.set(oid, decodeBlob(utf8, output.subarray(offset, offset + size)))
    offset += size + 1
  }
  return blobs
}

function decodeBlob(utf8: TextDecoder, body: Buffer): string {
  try {
    return utf8.decode(body)
  } catch {
    return body.toString("latin1")
  }
}
