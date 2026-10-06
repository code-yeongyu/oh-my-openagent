import { existsSync } from "../fs/resilient"
import { mkdir, rm, writeFile } from "../fs/resilient"
import { dirname, join } from "node:path"
import { withGitLockRetry, withSerializedGitConfigMutation } from "./config-lock"
import { DirtyRepoError, NoEffectiveChangesError } from "./errors"
import { createNodeGitExec, type GitExec, type GitExecResult } from "./exec"
import { describeDirtyMarkdownEncodingIssues } from "./porcelain"
import { GitPathStateStore } from "./path-state"
import { authorFlags, commandError, normalizePathspecs, normalizeSeedPath } from "./repo-arguments"
import { parseLogOutput, parseNulPaths } from "./repo-log"
import { runMemoryRepoMaintenance } from "./repo-maintenance"
import { parseCatFileBatch, parseLsTreeBlobs, parseLsTreeSized } from "./repo-tree"
import { assertNoUnrelatedChanges } from "./repo-status"
import { MemorySecretError, secretPatternClassOf } from "./secret"
import { scanSecretLikeMaterial } from "../sync/redact"
import { withSerializedGitWorktreeMutation } from "./worktree-mutation-queue"
import type {
  GitCommitAuthor,
  GitCommitResult,
  GitLogOptions,
  GitMaintenanceOptions,
  GitMaintenanceResult,
  GitMemoryRepoOptions,
  GitMergeOptions,
  GitTreeBlobEntry,
  GitTreeSizedEntry,
  InitializeGitRepoOptions,
  MemoryCommit,
} from "./repo-types"

export type {
  GitCommitAuthor, GitCommitResult, GitLogOptions, GitMaintenanceOptions, GitMaintenanceResult, GitMemoryRepoOptions,
  GitMergeOptions, GitSeedFile, GitTreeBlobEntry, GitTreeSizedEntry, InitializeGitRepoOptions, MemoryCommit,
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
      await withGitLockRetry(() => this.git(["init", "--template="]))
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
    await this.assertNoSecretLikeStaging(normalized)
    return this.commitStaged(reason, author)
  }

  async status(paths: readonly string[] = []): Promise<string> {
    const normalized = normalizePathspecs(paths)
    const suffix = normalized.length > 0 ? ["--", ...normalized] : []
    return (await this.git(["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all", ...suffix])).stdout
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

  async lsTreeBlobs(revision = "HEAD"): Promise<readonly GitTreeBlobEntry[]> {
    return parseLsTreeBlobs((await this.git(["ls-tree", "-r", "-z", revision])).stdout)
  }

    async show(revision: string, path: string): Promise<string> {
    return (await this.git(["show", `${revision}:${path}`])).stdout
  }

  /**
   * Roll index and worktree back to HEAD for the given pathspecs after a refused
   * staging: paths tracked at HEAD are restored on both sides (`git restore
   * --source=HEAD --staged --worktree`), and paths new at HEAD are unstaged and
   * removed, so a refused tool call leaves no trace behind.
   */
  async restorePaths(paths: readonly string[]): Promise<void> {
    const normalized = normalizePathspecs(paths)
    if (normalized.length === 0) return
    const atHead = new Set(await this.lsTree("HEAD"))
    const tracked = normalized.filter((path) => atHead.has(path))
    const untracked = normalized.filter((path) => !atHead.has(path))
    if (tracked.length > 0) {
      await withGitLockRetry(() => this.git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]))
    }
    for (const path of untracked) {
      await withGitLockRetry(() => this.git(["rm", "-q", "--cached", "--ignore-unmatch", "--", path]))
      await rm(join(this.dir, path), { force: true })
    }
  }

  /**
   * Refuse a staged commit that would carry secret-like material: first every
   * normalized path string (a file name is repository-controlled text like any
   * body), then every staged blob's full content. Reads come from the INDEX
   * (`git show :<path>`), never the worktree, and deletions are skipped because
   * their blob is gone.
   */
  private async assertNoSecretLikeStaging(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const patternClass = secretPatternClassOf(path)
      if (patternClass !== undefined) throw new MemorySecretError({ path, patternClass, where: "path" })
    }
    for (const path of paths) {
      const result = await this.gitResult(["show", `:${path}`])
      if (result.code !== 0) continue
      const patternClass = secretPatternClassOf(result.stdout)
      if (patternClass !== undefined) throw new MemorySecretError({ path, patternClass, where: "content" })
    }
  }

  /**
   * Reads every requested blob through ONE `git cat-file --batch` process. Reading a whole tree with
   * one `git show` per file spawned thousands of processes per HEAD move on a large memory repo.
   * Object ids git reports missing are absent from the returned map.
   */
  async readBlobs(oids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(oids)]
    if (unique.length === 0) return new Map()
    const argv = ["cat-file", "--batch"]
    const result = await this.gitResult(argv, `${unique.join("\n")}\n`)
    if (result.code !== 0) throw commandError(argv, result)
    return parseCatFileBatch(result.stdoutBytes ?? Buffer.from(result.stdout, "utf8"))
  }

  async log(options: GitLogOptions = {}): Promise<readonly MemoryCommit[]> {
    const argv = ["log", "--format=%x1e%H%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%cI"]
    // `--fixed-strings` because callers pass trailer literals, `--all-match` because every one of them
    // must appear in the same commit. Filtering inside git means a caller after one trailer combination
    // no longer parses the whole history into memory to find it.
    if (options.grep !== undefined && options.grep.length > 0) {
      argv.push("--fixed-strings", "--all-match", ...options.grep.map((pattern) => `--grep=${pattern}`))
    }
    if (options.limit !== undefined) argv.push("-n", String(options.limit))
    if (options.since !== undefined) argv.push(`--since=${options.since.toISOString()}`)
    if (options.range !== undefined) argv.push(options.range)
    if (options.paths !== undefined && options.paths.length > 0) argv.push("--", ...options.paths)
    const records = parseLogOutput((await this.git(argv, options.timeoutMs)).stdout)
    if (options.includePaths !== true) return records
    return Promise.all(records.map(async (commit) => ({
      ...commit,
      paths: parseNulPaths((await this.git([
        "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", commit.sha,
      ])).stdout),
    })))
  }

  /** Packs loose objects off the hot path; see `runMemoryRepoMaintenance`. */
  maintain(options: GitMaintenanceOptions): Promise<GitMaintenanceResult> {
    return runMemoryRepoMaintenance((argv, timeoutMs, signal) => this.git(argv, timeoutMs, signal), options)
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

  private async git(argv: readonly string[], timeoutMs?: number, signal?: AbortSignal): Promise<GitExecResult> {
    const result = await this.gitResult(argv, undefined, timeoutMs, signal)
    if (result.code !== 0) throw commandError(argv, result)
    return result
  }

  private gitResult(
    argv: readonly string[],
    stdin?: string,
    timeoutMs = GIT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<GitExecResult> {
    return this.exec.run(argv, {
      cwd: this.dir,
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...(stdin === undefined ? {} : { stdin }),
    })
  }
}
