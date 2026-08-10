import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { withSerializedGitConfigMutation } from "./config-lock"
import {
  DirtyRepoError,
  GitCommandError,
  InvalidGitPathError,
  NoEffectiveChangesError,
} from "./errors"
import { createNodeGitExec, type GitExec, type GitExecResult } from "./exec"
import { describeDirtyMarkdownEncodingIssues, parsePorcelainPath } from "./porcelain"

const GIT_TIMEOUT_MS = 30_000
const INITIAL_COMMIT = "chore: initialize local memory"
const EMPTY_INITIAL_COMMIT = "chore: initialize empty local memory"

export interface GitCommitAuthor {
  agentId: string
  authorName: string
  authorEmail?: string
}

export interface GitSeedFile {
  relativePath: string
  content: string
}

export interface GitMemoryRepoOptions {
  dir: string
  agentId: string
  exec?: GitExec
  installHooks?: (dir: string) => void | Promise<void>
}

export interface InitializeGitRepoOptions {
  authorName?: string
  seedFiles?: readonly GitSeedFile[]
  installHooks?: (dir: string) => void | Promise<void>
}

export interface GitCommitResult {
  committed: true
  sha: string
}

export interface GitMergeOptions {
  noFF?: boolean
  message?: string
}

export class GitMemoryRepo {
  readonly dir: string
  readonly agentId: string
  private readonly exec: GitExec
  private readonly hookInstaller: (dir: string) => void | Promise<void>

  constructor(options: GitMemoryRepoOptions) {
    this.dir = options.dir
    this.agentId = options.agentId
    this.exec = options.exec ?? createNodeGitExec()
    this.hookInstaller = options.installHooks ?? (() => undefined)
  }

  async init(options: InitializeGitRepoOptions = {}): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    if (!existsSync(join(this.dir, ".git"))) {
      await this.git(["init"])
      await this.git(["symbolic-ref", "HEAD", "refs/heads/main"])
    }

    await (options.installHooks ?? this.hookInstaller)(this.dir)
    await this.ensureIdentity(options.authorName?.trim() || "Omo Agent")
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
      authorName: options.authorName?.trim() || "Omo Agent",
    }
    if (paths.length > 0) {
      await this.stage(paths)
      if (await this.hasPathChanges(paths)) {
        return (await this.commitStaged(INITIAL_COMMIT, author, paths)).sha
      }
    }

    await this.git([...authorFlags(author), "commit", "--allow-empty", "-m", EMPTY_INITIAL_COMMIT])
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

    await this.assertNoUnrelatedChanges(normalized)
    await this.stage(normalized)
    if (!(await this.hasPathChanges(normalized))) {
      throw new NoEffectiveChangesError(normalized)
    }
    return this.commitStaged(reason, author, normalized)
  }

  async status(paths: readonly string[] = []): Promise<string> {
    const normalized = normalizePathspecs(paths)
    const suffix = normalized.length > 0 ? ["--", ...normalized] : []
    return (await this.git(["status", "--porcelain", ...suffix])).stdout
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

  async show(revision: string, path: string): Promise<string> {
    return (await this.git(["show", `${revision}:${path}`])).stdout
  }

  async worktreeAdd(path: string, branch: string, startPoint = "HEAD"): Promise<void> {
    await this.git(["worktree", "add", "-b", branch, path, startPoint])
  }

  async worktreeRemove(path: string, force = true): Promise<void> {
    await this.git(["worktree", "remove", ...(force ? ["--force"] : []), path])
  }

  async merge(ref: string, options: GitMergeOptions = {}): Promise<string> {
    const argv = ["merge"]
    if (options.noFF ?? true) argv.push("--no-ff")
    if (options.message) argv.push("-m", options.message)
    argv.push(ref)
    await this.git(argv)
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
  }

  private async assertNoUnrelatedChanges(paths: readonly string[]): Promise<void> {
    const porcelain = await this.status()
    const unrelated = porcelain.split(/\r?\n/).filter(Boolean).filter((line) => {
      const path = parsePorcelainPath(line)
      return path !== null && !paths.some((allowed) =>
        path === allowed || path.startsWith(`${allowed}/`) || allowed.startsWith(path.endsWith("/") ? path : `${path}/`),
      )
    })
    if (unrelated.length > 0) {
      const listing = `${unrelated.join("\n")}\n`
      throw new DirtyRepoError(listing, describeDirtyMarkdownEncodingIssues(this.dir, listing))
    }
  }

  private async stage(paths: readonly string[]): Promise<void> {
    await this.git(["add", "-A", "--", ...paths])
  }

  private async hasPathChanges(paths: readonly string[]): Promise<boolean> {
    return (await this.status(paths)).trim().length > 0
  }

  private async commitStaged(
    reason: string,
    author: GitCommitAuthor,
    paths: readonly string[],
  ): Promise<GitCommitResult> {
    try {
      await this.git([...authorFlags(author), "commit", "-m", reason])
    } catch (error) {
      await this.gitResult(["reset", "HEAD", "--", ...paths])
      throw error
    }
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

function authorFlags(author: GitCommitAuthor): string[] {
  const name = author.authorName.trim() || author.agentId
  const email = author.authorEmail ?? `${author.agentId}@omo.local`
  return ["-c", `user.name=${name}`, "-c", `user.email=${email}`]
}

function normalizePathspecs(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/\\/g, "/")).filter((path) => path.trim()))]
}

function normalizeSeedPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  if (!normalized || normalized.startsWith("/") || segments.some((segment) => segment === "." || segment === "..")) {
    throw new InvalidGitPathError(`Invalid memory seed path: ${path}`)
  }
  return segments.join("/")
}

function commandError(argv: readonly string[], result: GitExecResult): GitCommandError {
  return new GitCommandError(argv, result.code, result.stdout, result.stderr)
}
