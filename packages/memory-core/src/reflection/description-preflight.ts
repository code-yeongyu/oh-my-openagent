import { join } from "node:path"
import { lstat, readFile, writeFile } from "../fs/resilient"
import { GitMemoryRepo, type GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { parseMemoryFile } from "../memfs/frontmatter"
import { FRONTMATTER_RE, renderStringScalar } from "../memfs/frontmatter-scalar"
import { describeFrontmatterViolation, MAX_DESCRIPTION_LENGTH } from "../memfs/frontmatter-validation"
import { isMemoryContentPath } from "../memfs/paths"
import { redactSecretLikeMaterial } from "../sync/redact"
import { frontmatterBlock, listReflectionChangedPaths } from "./completion-validation"
import type { ReflectionWorktree } from "./worktree"

export interface TrimmedDescription {
  readonly path: string
  readonly originalLength: number
  readonly newLength: number
}

export type DescriptionPreflightWarn = (message: string, fields: Readonly<Record<string, unknown>>) => void

/** Repair only length violations in a clean, finished reflection branch, before its pure gate runs. */
export async function preflightReflectionDescriptions(
  worktree: ReflectionWorktree,
  recordedBase: string,
  exec: GitExec = worktree.exec,
  warn?: DescriptionPreflightWarn,
): Promise<readonly TrimmedDescription[]> {
  const repo = new GitMemoryRepo({ dir: worktree.dir, agentId: worktree.parent.agentId, exec })
  const rewritten: string[] = []
  try {
    return await trimDescriptions(worktree, recordedBase, exec, repo, rewritten)
  } catch (error) {
    let rollbackError: unknown
    try {
      await repo.restorePaths(rewritten)
    } catch (cause) {
      rollbackError = cause
    }
    try {
      warn?.("memory description preflight failed; completion validation will decide the outcome", {
        error: redactSecretLikeMaterial(error instanceof Error ? error.message : String(error)),
        ...(rollbackError === undefined ? {} : {
          rollbackError: redactSecretLikeMaterial(rollbackError instanceof Error ? rollbackError.message : String(rollbackError)),
        }),
      })
    } catch {
      // A diagnostic sink must not prevent the gate from settling the run either.
      return []
    }
    return []
  }
}

async function trimDescriptions(
  worktree: ReflectionWorktree,
  recordedBase: string,
  exec: GitExec,
  repo: GitMemoryRepo,
  rewritten: string[],
): Promise<readonly TrimmedDescription[]> {
  // Leave dirty or tampered runs to the gate; never commit their unrelated changes.
  if (await readFile(worktree.gitFilePath, "utf8") !== worktree.gitFileSnapshot) return []
  const config = await readFile(worktree.commonConfigPath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (config !== worktree.commonConfigSnapshot) return []
  const git = async (argv: readonly string[]) => {
    const result = await exec.run(argv, {
      cwd: worktree.dir,
      timeoutMs: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
    return result.stdout.trimEnd()
  }
  if ((await git(["status", "--porcelain"])).trim()) return []
  if (await git(["branch", "--show-current"]) !== worktree.branch) return []
  const tipSha = await git(["rev-parse", "--verify", "HEAD"])
  if (tipSha === recordedBase) return []
  const based = await exec.run(["merge-base", "--is-ancestor", recordedBase, tipSha], {
    cwd: worktree.dir,
    timeoutMs: 30_000,
  })
  if (based.code !== 0) return []

  const trimmed: TrimmedDescription[] = []
  for (const path of await listReflectionChangedPaths(exec, worktree.dir, recordedBase, tipSha)) {
    if (!isMemoryContentPath(path)) continue
    const blob = await exec.run(["cat-file", "blob", `${tipSha}:${path}`], { cwd: worktree.dir, timeoutMs: 30_000 })
    if (blob.code !== 0) continue // Deleted paths have no description to repair.
    const content = blob.stdout
    const violation = describeFrontmatterViolation(content)
    if (violation === null) continue
    // Grammar is validated before description length, so equality excludes every other violation.
    if (!violation.startsWith(`'description' exceeds ${MAX_DESCRIPTION_LENGTH} characters (`)) continue
    const base = await exec.run(["cat-file", "blob", `${recordedBase}:${path}`], { cwd: worktree.dir, timeoutMs: 30_000 })
    if (base.code === 0 && frontmatterBlock(base.stdout) === frontmatterBlock(content)) continue
    const parsed = parseMemoryFile(content)
    const original = parsed.frontmatter.description
    if (violation !== `'description' exceeds ${MAX_DESCRIPTION_LENGTH} characters (${original.length})`) continue
    const absolute = join(worktree.dir, path)
    if (!(await lstat(absolute)).isFile()) continue
    let prefix = ""
    for (const codePoint of original) {
      if (prefix.length + codePoint.length > MAX_DESCRIPTION_LENGTH - 1) break
      prefix += codePoint
    }
    const boundary = original.lastIndexOf(" ", prefix.length)
    const description = `${(boundary > 0 ? original.slice(0, boundary) : prefix).trimEnd()}…`
    const header = FRONTMATTER_RE.exec(content)?.[1] ?? ""
    const headerStart = content.indexOf("\n") + 1
    const rendered = content.slice(0, headerStart)
      + header.replace(/^(description:[ \t]+)[^\r\n]*/m, (_line, spacing: string) => `${spacing}${renderStringScalar(description)}`)
      + content.slice(headerStart + header.length)
    rewritten.push(path)
    await writeFile(absolute, rendered, "utf8")
    trimmed.push({ path, originalLength: original.length, newLength: parseMemoryFile(rendered).frontmatter.description.length })
  }
  if (trimmed.length === 0) return trimmed

  const [authorName = "", authorEmail = ""] = (await git([...STABLE_LOG_OUTPUT, "show", "-s", "--format=%an%x00%ae", tipSha])).split("\0")
  await repo.commitWrite(
    trimmed.map(({ path }) => path),
    [
      "fix(reflection): trim oversized memory descriptions",
      "",
      ...trimmed.map(({ path, originalLength, newLength }) =>
        `Omo-Description-Trimmed: ${path} (${originalLength} -> ${newLength})`),
    ].join("\n"),
    { agentId: worktree.parent.agentId, authorName, authorEmail },
  )
  return trimmed
}
