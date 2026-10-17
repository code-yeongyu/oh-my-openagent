// Read-only views of committed history: HEAD, trees, blobs and the commit log at a revision.

import type { GitExecResult } from "./exec"
import { commandError } from "./repo-arguments"
import { parseLogOutput, parseNulPaths } from "./repo-log"
import { parseCatFileBatch, parseLsTreeBlobs, parseLsTreeSized } from "./repo-tree"
import type { GitLogOptions, GitTreeBlobEntry, GitTreeSizedEntry, MemoryCommit } from "./repo-types"

export interface GitRevisionRunner {
  /** Runs git and throws the command error on a non-zero exit. */
  run(argv: readonly string[], timeoutMs?: number): Promise<GitExecResult>
  /** Runs git and returns the result whatever the exit code. */
  result(argv: readonly string[], stdin?: string): Promise<GitExecResult>
}

export class GitRevisionReads {
  constructor(private readonly git: GitRevisionRunner) {}

  async head(): Promise<string | null> {
    const result = await this.git.result(["rev-parse", "--verify", "HEAD"])
    if (result.code !== 0) return null
    return result.stdout.trim() || null
  }

  async headCommitTimestamp(): Promise<number | null> {
    const result = await this.git.result(["show", "-s", "--format=%ct", "HEAD"])
    if (result.code !== 0) return null
    const timestamp = Number.parseInt(result.stdout.trim(), 10)
    return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
  }

  async lsTree(revision = "HEAD", path?: string): Promise<string[]> {
    const suffix = path ? ["--", path] : []
    const result = await this.git.run(["ls-tree", "-r", "--name-only", "-z", revision, ...suffix])
    return result.stdout.split("\0").filter(Boolean)
  }

  async lsTreeSized(revision = "HEAD"): Promise<readonly GitTreeSizedEntry[]> {
    return parseLsTreeSized((await this.git.run(["ls-tree", "-r", "-l", "-z", revision])).stdout)
  }

  async lsTreeBlobs(revision = "HEAD"): Promise<readonly GitTreeBlobEntry[]> {
    return parseLsTreeBlobs((await this.git.run(["ls-tree", "-r", "-z", revision])).stdout)
  }

  async show(revision: string, path: string): Promise<string> {
    return (await this.git.run(["show", `${revision}:${path}`])).stdout
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
    const result = await this.git.result(argv, `${unique.join("\n")}\n`)
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
    const records = parseLogOutput((await this.git.run(argv, options.timeoutMs)).stdout)
    if (options.includePaths !== true) return records
    return Promise.all(records.map(async (commit) => ({
      ...commit,
      paths: parseNulPaths((await this.git.run([
        "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", commit.sha,
      ])).stdout),
    })))
  }
}
