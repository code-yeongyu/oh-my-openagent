import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createNodeGitExec,
  withSerializedGitConfigMutation,
  type GitExec,
  type GitExecResult,
  type GitMemoryRepo,
} from "../git"
import { redactUrl } from "./redact"

/** Repo-local git config key holding the mirror URL (letta used `letta.*`). */
export const CONFIG_KEY = "omo.memoryRepository.url"

/** Push log file name, relative to the repository's git directory. */
export const LOG_NAME = "memory-repository-push.log"

/** Set to `1` to run the post-commit push in the foreground (tests, CI). */
export const SYNC_PUSH_ENV = "OMO_MEMORY_PUSH_SYNC"

/** The mirror only ever tracks `main`; reflection branches must not mirror. */
const BRANCH = "main"
const INITIAL_PUSH_TIMEOUT_MS = 10_000
const PUSH_TIMEOUT_MS = 60_000
const QUERY_TIMEOUT_MS = 10_000
const STATUS_LOG_LINES = 20

export interface MirrorSyncOptions {
  repo: GitMemoryRepo
  exec?: GitExec
}

export interface MirrorPushResult {
  pushed: boolean
  /** Human-readable outcome, already redacted. Empty on success. */
  detail: string
}

export interface MirrorSetResult extends MirrorPushResult {
  /** The normalized URL that was written to git config. */
  url: string
}

export interface MirrorStatus {
  url?: string
  redactedUrl?: string
  /** Tail of the push log, newest last, already redacted. */
  lastLogLines: string[]
  /** Commits on `main` not known to be on the mirror. */
  aheadCount: number
}

/** Absolute path of the push log for a repository working directory. */
export function mirrorLogPath(repoDir: string): string {
  return join(repoDir, ".git", LOG_NAME)
}

/**
 * Push-only mirror of a memory repository (letta `memory-git.ts` parity).
 *
 * The mirror is a user-owned backup remote, never a source of truth: there is
 * deliberately no pull, fetch or import path anywhere in this module. History
 * flows one way, and a mirror that rejects a push is a reportable condition,
 * never a reason to rewrite local memory.
 */
export class MirrorSync {
  private readonly repo: GitMemoryRepo
  private readonly exec: GitExec

  constructor(options: MirrorSyncOptions) {
    this.repo = options.repo
    this.exec = options.exec ?? createNodeGitExec()
  }

  /**
   * Configure the mirror and attempt one best-effort initial push.
   *
   * The config write lands first and is never rolled back: an unreachable or
   * not-yet-created remote is the normal case when a user pastes a URL, and
   * the post-commit hook will retry on every future commit.
   */
  async set(url: string): Promise<MirrorSetResult> {
    const normalized = normalizeUrl(url)
    if (!normalized) throw new Error("Memory repository URL must not be empty")

    await this.repo.configSet(CONFIG_KEY, normalized)
    const push = await this.push(normalized, INITIAL_PUSH_TIMEOUT_MS)
    return { url: normalized, ...push }
  }

  /** Remove the mirror configuration. Future commits stop pushing and stop logging. */
  async unset(): Promise<void> {
    await withSerializedGitConfigMutation(this.repo.dir, async () => {
      const result = await this.run(["config", "--local", "--unset-all", CONFIG_KEY], QUERY_TIMEOUT_MS)
      // Exit code 5 is "key was not there", which is the desired end state.
      if (result.code !== 0 && result.code !== 5) throw new Error(describe(result))
    })
  }

  async status(): Promise<MirrorStatus> {
    const url = await this.configuredUrl()
    const lastLogLines = this.readLogTail()
    if (!url) return { lastLogLines, aheadCount: 0 }
    return {
      url,
      redactedUrl: redactUrl(url),
      lastLogLines,
      aheadCount: await this.aheadCount(url),
    }
  }

  /** One-shot foreground push of `main:main`. Never throws on push failure. */
  async pushNow(): Promise<MirrorPushResult> {
    const url = await this.configuredUrl()
    if (!url) {
      return { pushed: false, detail: "No memory repository configured. Set one first." }
    }
    return this.push(url, PUSH_TIMEOUT_MS)
  }

  private async configuredUrl(): Promise<string | undefined> {
    const raw = await this.repo.configGet(CONFIG_KEY)
    return normalizeUrl(raw ?? "") || undefined
  }

  private async push(url: string, timeoutMs: number): Promise<MirrorPushResult> {
    const result = await this.run(
      ["push", "--quiet", url, `${BRANCH}:${BRANCH}`],
      timeoutMs,
    )
    if (result.code === 0) return { pushed: true, detail: "" }
    return { pushed: false, detail: redactUrl(describe(result)) }
  }

  /**
   * Commits on local `main` that the mirror is not known to have.
   *
   * The remote head is read with `ls-remote`, which lists refs without
   * importing objects - the push-only invariant holds. When the mirror is
   * unreachable or has no `main` yet, every local commit counts as ahead.
   */
  private async aheadCount(url: string): Promise<number> {
    const remote = await this.run(["ls-remote", url, `refs/heads/${BRANCH}`], QUERY_TIMEOUT_MS)
    const remoteSha = remote.code === 0 ? (remote.stdout.trim().split(/\s+/)[0] ?? "") : ""
    const range = remoteSha ? `${remoteSha}..${BRANCH}` : BRANCH
    const counted = await this.run(["rev-list", "--count", range], QUERY_TIMEOUT_MS)
    if (counted.code !== 0) return 0
    return Number.parseInt(counted.stdout.trim(), 10) || 0
  }

  private readLogTail(): string[] {
    let raw: string
    try {
      raw = readFileSync(mirrorLogPath(this.repo.dir), "utf8")
    } catch {
      return []
    }
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-STATUS_LOG_LINES)
      .map(redactUrl)
  }

  private async run(argv: readonly string[], timeoutMs: number): Promise<GitExecResult> {
    try {
      return await this.exec.run(argv, {
        cwd: this.repo.dir,
        timeoutMs,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    } catch (error) {
      return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * The post-commit snippet the hook installer embeds.
 *
 * Kept here beside the config key and log name it depends on so the three
 * cannot drift apart. Guarantees: never blocks a commit, never pushes from a
 * detached HEAD or a non-`main` branch, appends every attempt to the log, and
 * backgrounds the push unless `OMO_MEMORY_PUSH_SYNC=1` forces foreground.
 */
export function getPostCommitHookScript(): string {
  return `#!/bin/sh
# Push memory commits to the configured memory-repository mirror.
# Installed by omo memory-core. Do not edit by hand - regenerated on startup.
url=$(git config --local --get ${CONFIG_KEY} 2>/dev/null)
[ -z "$url" ] && exit 0

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || exit 0
[ -z "$branch" ] && exit 0
[ "$branch" != "${BRANCH}" ] && exit 0

log="$(git rev-parse --git-dir)/${LOG_NAME}"

push_to_mirror() {
  {
    printf '\\n--- %s %s on %s ---\\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$(git rev-parse --short HEAD)" "$branch"
    git push --quiet "$url" "$branch:$branch" 2>&1
    echo "exit=$?"
  } >> "$log" 2>&1
}

if [ "$${SYNC_PUSH_ENV}" = "1" ]; then
  push_to_mirror
  exit 0
fi

push_to_mirror &
exit 0
`
}

/** Strip surrounding whitespace and trailing slashes; `file:///x///` -> `file:///x`. */
function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  const stripped = trimmed.replace(/\/+$/, "")
  return stripped || trimmed
}

function describe(result: GitExecResult): string {
  return result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.code}`
}
