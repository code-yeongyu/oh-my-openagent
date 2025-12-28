import { executeCommand } from "../../shared/command-executor"
import { log } from "../../shared/logger"
import {
  DEFAULT_UPSTREAM_REMOTE,
  FALLBACK_UPSTREAM_BRANCHES,
  GIT_LOG_FORMAT,
  GIT_DATE_FORMAT,
  COMMIT_TYPE_PATTERNS,
  SECURITY_KEYWORDS,
} from "./constants"
import type {
  GitContext,
  PreflightResult,
  ParsedCommit,
  CommitType,
  FileChange,
} from "./types"

async function git(args: string, cwd?: string): Promise<string> {
  const cmd = cwd ? `cd "${cwd}" && git ${args}` : `git ${args}`
  return executeCommand(cmd)
}

async function getRepoRoot(): Promise<string> {
  const result = await git("rev-parse --show-toplevel")
  if (result.includes("[stderr:")) {
    throw new Error("Not a git repository")
  }
  return result.trim()
}

async function isWorktree(repoRoot: string): Promise<boolean> {
  try {
    const gitDir = await git("rev-parse --git-dir", repoRoot)
    return gitDir.trim().includes(".git/worktrees")
  } catch {
    return false
  }
}

async function isShallowRepo(repoRoot: string): Promise<boolean> {
  const result = await git("rev-parse --is-shallow-repository", repoRoot)
  return result.trim() === "true"
}

async function isDirtyWorkTree(repoRoot: string): Promise<boolean> {
  const result = await git("status --porcelain", repoRoot)
  return result.trim().length > 0
}

async function isDetachedHead(repoRoot: string): Promise<boolean> {
  const result = await git("symbolic-ref -q HEAD", repoRoot)
  return result.includes("[stderr:")
}

async function getHeadCommit(repoRoot: string): Promise<string> {
  const result = await git("rev-parse HEAD", repoRoot)
  return result.trim()
}

async function hasUpstreamRemote(
  repoRoot: string,
  remote: string
): Promise<boolean> {
  const result = await git(`remote get-url ${remote}`, repoRoot)
  return !result.includes("[stderr:")
}

async function resolveUpstreamBranch(
  repoRoot: string,
  remote: string
): Promise<string | null> {
  const headRef = await git(`symbolic-ref refs/remotes/${remote}/HEAD`, repoRoot)
  if (!headRef.includes("[stderr:")) {
    const match = headRef.match(/refs\/remotes\/[^/]+\/(.+)/)
    if (match) return match[1].trim()
  }

  for (const branch of FALLBACK_UPSTREAM_BRANCHES) {
    const result = await git(
      `rev-parse --verify refs/remotes/${remote}/${branch}`,
      repoRoot
    )
    if (!result.includes("[stderr:")) {
      return branch
    }
  }

  return null
}

async function getMergeBase(
  repoRoot: string,
  remote: string,
  branch: string
): Promise<string> {
  const result = await git(`merge-base HEAD ${remote}/${branch}`, repoRoot)
  if (result.includes("[stderr:")) {
    throw new Error(`Failed to find merge-base with ${remote}/${branch}`)
  }
  return result.trim()
}

async function fetchUpstream(repoRoot: string, remote: string): Promise<void> {
  log(`[sync-fork] Fetching ${remote}...`)
  const result = await git(`fetch ${remote}`, repoRoot)
  if (result.includes("error:") || result.includes("fatal:")) {
    throw new Error(`Failed to fetch ${remote}: ${result}`)
  }
}

export async function runPreflight(
  remote: string = DEFAULT_UPSTREAM_REMOTE
): Promise<PreflightResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const suggestions: string[] = []

  try {
    const repoRoot = await getRepoRoot()

    if (!(await hasUpstreamRemote(repoRoot, remote))) {
      errors.push(`No '${remote}' remote found`)
      suggestions.push(
        `Add upstream remote: git remote add ${remote} <UPSTREAM_URL>`
      )
      return { success: false, warnings, errors, suggestions }
    }

    await fetchUpstream(repoRoot, remote)

    const upstreamBranch = await resolveUpstreamBranch(repoRoot, remote)
    if (!upstreamBranch) {
      errors.push(`Could not resolve ${remote} branch`)
      suggestions.push(`Ensure ${remote} has a main or master branch`)
      return { success: false, warnings, errors, suggestions }
    }

    const isWork = await isWorktree(repoRoot)
    const isShallow = await isShallowRepo(repoRoot)
    const isDirty = await isDirtyWorkTree(repoRoot)
    const isDetached = await isDetachedHead(repoRoot)

    if (isShallow) {
      warnings.push("Repository is shallow clone")
      suggestions.push("Run `git fetch --unshallow` for full history")
    }

    if (isDirty) {
      warnings.push("Working tree has uncommitted changes")
    }

    if (isDetached) {
      warnings.push("HEAD is detached")
      suggestions.push("Checkout a branch before syncing")
    }

    const headCommit = await getHeadCommit(repoRoot)
    const mergeBase = await getMergeBase(repoRoot, remote, upstreamBranch)

    const context: GitContext = {
      repoRoot,
      upstreamRemote: remote,
      upstreamBranch,
      headCommit,
      mergeBase,
      isWorktree: isWork,
      isShallow,
      isDirty,
      isDetached,
    }

    return { success: true, context, warnings, errors, suggestions }
  } catch (e) {
    errors.push(String(e))
    return { success: false, warnings, errors, suggestions }
  }
}

function parseConventionalCommit(subject: string): {
  type: CommitType
  scope?: string
  isBreaking: boolean
} {
  const pattern = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*/
  const match = subject.match(pattern)

  if (!match) {
    return { type: "other", isBreaking: false }
  }

  const [, rawType, scope, breaking] = match
  const type = COMMIT_TYPE_PATTERNS[rawType.toLowerCase()] || "other"
  const isBreaking = Boolean(breaking)

  return { type, scope, isBreaking }
}

function detectSecurityCommit(subject: string, body?: string): boolean {
  const text = `${subject} ${body || ""}`.toLowerCase()
  return SECURITY_KEYWORDS.some((kw) => text.includes(kw))
}

function parseCommitLine(line: string): ParsedCommit | null {
  const parts = line.split("\x1f")
  if (parts.length < 4) return null

  const [sha, author, date, subject, parents = ""] = parts
  const { type, scope, isBreaking } = parseConventionalCommit(subject)
  const isMerge = parents.trim().split(" ").length > 1
  const isSecurity = detectSecurityCommit(subject)

  const prMatch = subject.match(/#(\d+)/)
  const prNumber = prMatch ? prMatch[1] : undefined

  return {
    sha: sha.trim(),
    shortSha: sha.trim().slice(0, 7),
    type: isSecurity ? "security" : type,
    scope,
    subject: subject.trim(),
    author: author.trim(),
    date: date.trim(),
    files: [],
    isBreaking,
    isMerge,
    prNumber,
  }
}

export async function getUpstreamCommits(
  context: GitContext,
  since?: string,
  limit?: number
): Promise<ParsedCommit[]> {
  const { repoRoot, upstreamRemote, upstreamBranch, mergeBase } = context

  let gitLogCmd = `log --reverse --pretty=format:"${GIT_LOG_FORMAT}" --date=${GIT_DATE_FORMAT}`

  if (since) {
    gitLogCmd += ` --since="${since}"`
  }

  if (limit) {
    gitLogCmd += ` -n ${limit}`
  }

  gitLogCmd += ` ${mergeBase}..${upstreamRemote}/${upstreamBranch}`

  const result = await git(gitLogCmd, repoRoot)
  if (result.includes("[stderr:") && !result.includes("fatal:")) {
    log(`[sync-fork] Git log warning: ${result}`)
  }

  if (!result.trim() || result.includes("fatal:")) {
    return []
  }

  const commits: ParsedCommit[] = []
  const records = result.split("\x1e").filter(Boolean)

  for (const record of records) {
    const commit = parseCommitLine(record.trim())
    if (commit) {
      commits.push(commit)
    }
  }

  return commits
}

export async function getCommitFiles(
  repoRoot: string,
  sha: string
): Promise<FileChange[]> {
  const result = await git(`show --name-status --pretty=format: ${sha}`, repoRoot)
  if (result.includes("[stderr:")) {
    return []
  }

  const files: FileChange[] = []
  const lines = result.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    const [status, path] = line.split("\t")
    if (status && path) {
      files.push({
        path,
        status: status as FileChange["status"],
      })
    }
  }

  return files
}

export async function enrichCommitsWithFiles(
  repoRoot: string,
  commits: ParsedCommit[]
): Promise<void> {
  for (const commit of commits) {
    commit.files = await getCommitFiles(repoRoot, commit.sha)
  }
}
