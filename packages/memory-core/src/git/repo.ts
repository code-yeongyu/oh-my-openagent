import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { withGitLockRetry, withSerializedGitConfigMutation } from "./config-lock"
import { DirtyRepoError, NoEffectiveChangesError } from "./errors"
import { createNodeGitExec, type GitExec, type GitExecResult } from "./exec"
import { describeDirtyMarkdownEncodingIssues } from "./porcelain"
import { GitPathStateStore } from "./path-state"
import { authorFlags, commandError, normalizePathspecs, normalizeSeedPath } from "./repo-arguments"
import { parseLogOutput, parseNulPaths } from "./repo-log"
import { assertNoUnrelatedChanges } from "./repo-status"
import { withSerializedGitWorktreeMutation } from "./worktree-mutation-queue"
import type {
  GitCommitAuthor,
  GitCommitResult,
  GitLogOptions,
  GitMemoryRepoOptions,
  GitMergeOptions,
  GitTreeSizedEntry,
  InitializeGitRepoOptions,
  MemoryCommit,
} from "./repo-types"

export type {
  GitCommitAuthor, GitCommitResult, GitLogOptions, GitMemoryRepoOptions,
  GitMergeOptions, GitSeedFile, GitTreeSizedEntry, InitializeGitRepoOptions, MemoryCommit,
} from "./repo-types"

const GIT_TIMEOUT_MS = 30_000
const INITIAL_COMMIT = "chore: initialize local memory"
const EMPTY_INITIAL_COMMIT = "chore: initialize empty local memory"

export class GitMemoryRepo {
  readonly dir: string
  readonly agentId: string
  readonly pathState: GitPathStateStore
  private readonly exec: GitExec
  private readonly hookInstaller: (dir: string) => void | Promise<void>

  constructor(options: GitMemoryRepoOptions) {
    this.dir = options.dir
    this.agentId = options.agentId
    this.exec = options.exec ?? createNodeGitExec()
    this.pathState = new GitPathStateStore(this.dir, this.exec)
    this.hookInstaller = options.installHooks ?? (() => undefined)
  }

  async init(options: InitializeGitRepoOptions = {}): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    if (!existsSync(join(this.dir, ".git"))) {
      await withGitLockRetry(() => this.git(["init"]))
      await withGitLockRetry(() => this.git(["symbolic-ref", "HEAD", "refs/heads/main"]))
    }

    await (options.installHooks ?? this.hookInstaller)(this.dir)
    await this.ensureIdentity(options.authorName?.trim() || "OmO Agent")
    const currentHead = await this.head()
    if (currentHead) return currentHead

    const paths: string[] = []
    for (const seed of options.seedFiles ?? []) {
      const relativePath = normalizeSeedPath(seed.relativePath)
      const fullPath = join(this.dir, relativePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, seed.content, "utf8")
      paths.push(relativePath)
    }

    const author: GitCommitAuthor = {
      agentId: this.agentId,
      authorName: options.authorName?.trim() || "OmO Agent",
    }
    if (paths.length > 0) {
      await this.stage(paths)
      if (await this.hasPathChanges(paths)) {
        return (await this.commitStaged(INITIAL_COMMIT, author)).sha
      }
    }

    await withGitLockRetry(() =>
      this.git([...authorFlags(author), "commit", "--allow-empty", "-m", EMPTY_INITIAL_COMMIT]),
    )
    return this.requireHead()
  }

  async cleanCheck(): Promise<void> {
    await this.hookInstaller(this.dir)
    const porcelain = await this.status()
    if (!porcelain.trim()) return
    throw new DirtyRepoError(porcelain, describeDirtyMarkdownEncodingIssues(this.dir, porcelain))
  }

  async commitWrite(
    paths: readonly string[],
    reason: string,
    author: GitCommitAuthor,
  ): Promise<GitCommitResult> {
    await this.hookInstaller(this.dir)
    const normalized = normalizePathspecs(paths)
    if (normalized.length === 0) throw new NoEffectiveChangesError(normalized)

    await assertNoUnrelatedChanges(this.dir, normalized, () => this.status())
    await this.stage(normalized)
    return this.commitPrepared(normalized, reason, author)
  }

  async commitPrepared(
    paths: readonly string[],
    reason: string,
    author: GitCommitAuthor,
  ): Promise<GitCommitResult> {
    await this.hookInstaller(this.dir)
    const normalized = normalizePathspecs(paths)
    if (normalized.length === 0) throw new NoEffectiveChangesError(normalized)
    await assertNoUnrelatedChanges(this.dir, normalized, () => this.status())
    if (!(await this.hasPathChanges(normalized))) throw new NoEffectiveChangesError(normalized)
    return this.commitStaged(reason, author)
  }

  async status(paths: readonly string[] = []): Promise<string> {
    const normalized = normalizePathspecs(paths)
    const suffix = normalized.length > 0 ? ["--", ...normalized] : []
    return (await this.git(["status", "--porcelain", "--untracked-files=all", ...suffix])).stdout
  }

  async head(): Promise<string | null> {
    const result = await this.gitResult(["rev-parse", "--verify", "HEAD"])
    if (result.code !== 0) return null
    return result.stdout.trim() || null
  }

  async headCommitTimestamp(): Promise<number | null> {
    const result = await this.gitResult(["show", "-s", "--format=%ct", "HEAD"])
    if (result.code !== 0) return null
    const timestamp = Number.parseInt(result.stdout.trim(), 10)
    return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
  }

  async lsTree(revision = "HEAD", path?: string): Promise<string[]> {
    const suffix = path ? ["--", path] : []
    const result = await this.git(["ls-tree", "-r", "--name-only", "-z", revision, ...suffix])
    return result.stdout.split("\0").filter(Boolean)
  }

  async lsTreeSized(revision = "HEAD"): Promise<readonly GitTreeSizedEntry[]> {
    const result = await this.git(["ls-tree", "-r", "-l", "-z", revision])
    return parseLsTreeSized(result.stdout)
  }

  async show(revision: string, path: string): Promise<string> {
    return (await this.git(["show", `${revision}:${path}`])).stdout
  }

  async log(options: GitLogOptions = {}): Promise<readonly MemoryCommit[]> {
    const argv = ["log", "--format=%x1e%H%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%cI"]
    if (options.limit !== undefined) argv.push("-n", String(options.limit))
    if (options.range !== undefined) argv.push(options.range)
    if (options.paths !== undefined && options.paths.length > 0) argv.push("--", ...options.paths)
    const records = parseLogOutput((await this.git(argv)).stdout)
    if (options.includePaths !== true) return records
    return Promise.all(records.map(async (commit) => ({
      ...commit,
      paths: parseNulPaths((await this.git([
        "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", commit.sha,
      ])).stdout),
    })))
  }

  async worktreeAdd(path: string, branch: string, startPoint = "HEAD"): Promise<void> {
    await withSerializedGitWorktreeMutation(this.dir, () =>
      withGitLockRetry(() => this.git(["worktree", "add", "-b", branch, path, startPoint])),
    )
  }

  async worktreeRemove(path: string, force = true): Promise<void> {
    await withSerializedGitWorktreeMutation(this.dir, () =>
      withGitLockRetry(() => this.git(["worktree", "remove", ...(force ? ["--force"] : []), path])),
    )
  }

  async merge(ref: string, options: GitMergeOptions = {}): Promise<string> {
    const argv = ["merge"]
    if (options.noFF ?? true) argv.push("--no-ff")
    if (options.message) argv.push("-m", options.message)
    argv.push(ref)
    await withGitLockRetry(() => this.git(argv))
    return this.requireHead()
  }

  async configGet(key: string): Promise<string | null> {
    const result = await this.gitResult(["config", "--local", "--get", key])
    if (result.code === 1) return null
    if (result.code !== 0) throw commandError(["config", "--local", "--get", key], result)
    return result.stdout.trim() || null
  }

  async configSet(key: string, value: string): Promise<void> {
    await withSerializedGitConfigMutation(this.dir, async () => {
      await this.git(["config", "--local", key, value])
    })
  }

  private async ensureIdentity(authorName: string): Promise<void> {
    if ((await this.configGet("omo.agentId")) !== this.agentId) {
      await this.configSet("omo.agentId", this.agentId)
    }
    if (!(await this.configGet("user.email"))) {
      await this.configSet("user.email", `${this.agentId}@omo.local`)
    }
    if (!(await this.configGet("user.name"))) await this.configSet("user.name", authorName)
    if ((await this.configGet("commit.gpgsign")) === null) {
      await this.configSet("commit.gpgsign", "false")
    }
    if ((await this.configGet("gc.auto")) === null) {
      await this.configSet("gc.auto", "0")
    }
  }

  private async stage(paths: readonly string[]): Promise<void> {
    await withGitLockRetry(() => this.git(["add", "-A", "--", ...paths]))
  }

  private async hasPathChanges(paths: readonly string[]): Promise<boolean> {
    return (await this.status(paths)).trim().length > 0
  }

  private async commitStaged(
    reason: string,
    author: GitCommitAuthor,
  ): Promise<GitCommitResult> {
    await withGitLockRetry(() => this.git([...authorFlags(author), "commit", "-m", reason]))
    return { committed: true, sha: await this.requireHead() }
  }

  private async requireHead(): Promise<string> {
    const head = await this.head()
    if (!head) throw new Error("Memory repository has no HEAD commit")
    return head
  }

  private async git(argv: readonly string[]): Promise<GitExecResult> {
    const result = await this.gitResult(argv)
    if (result.code !== 0) throw commandError(argv, result)
    return result
  }

  private gitResult(argv: readonly string[]): Promise<GitExecResult> {
    return this.exec.run(argv, {
      cwd: this.dir,
      timeoutMs: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  }
}

function parseLsTreeSized(stdout: string): GitTreeSizedEntry[] {
  const entries: GitTreeSizedEntry[] = []
  for (const record of stdout.split("\0")) {
    if (record.length === 0) continue
    const tab = record.indexOf("\t")
    if (tab === -1) continue
    const meta = record.slice(0, tab).trim().split(/\s+/)
    const path = record.slice(tab + 1)
    if (meta.length < 4 || path.length === 0) continue
    const size = meta[3]
    if (size === undefined || size === "-") continue
    const bytes = Number.parseInt(size, 10)
    if (!Number.isSafeInteger(bytes) || bytes < 0) continue
    entries.push({ path, bytes })
  }
  return entries
}
