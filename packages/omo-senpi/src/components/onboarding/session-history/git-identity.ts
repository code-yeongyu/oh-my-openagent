import { join, resolve } from "node:path"

import { readFileStringOrEmpty, statOrNull, type SessionHistoryFs } from "./session-history-fs"
import type { ProjectGit } from "./types"

export type GitIdentity =
  | { readonly _tag: "Repository"; readonly git: ProjectGit }
  | { readonly _tag: "Worktree" }
  | { readonly _tag: "NotGit" }

function azureDevOpsRepositoryKey(host: string, segments: ReadonlyArray<string>): string | null {
  if (host !== "ssh.dev.azure.com" && host !== "vs-ssh.visualstudio.com") return null
  const [marker, organization, project, repository] = segments
  if (segments.length !== 4 || marker !== "v3") return null
  if (!organization || !project || !repository) return null
  return host === "ssh.dev.azure.com"
    ? `dev.azure.com/${organization}/${project}/_git/${repository}`
    : `${organization}.visualstudio.com/${project}/_git/${repository}`
}

export function normalizeGitRemoteUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/g, "").replace(/\.git$/i, "").toLowerCase()
  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized)
      const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
      if (url.hostname && segments.length > 1) {
        return azureDevOpsRepositoryKey(url.hostname, segments) ?? `${url.hostname}/${segments.join("/")}`
      }
    } catch {
      return normalized
    }
  }
  const scp = /^[a-zA-Z0-9._-]+@([^:/\s]+):([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized)
  const scpHost = scp?.[1]
  const scpPath = scp?.[2]
  if (scpHost && scpPath) return azureDevOpsRepositoryKey(scpHost, scpPath.split("/")) ?? `${scpHost}/${scpPath}`
  return normalized
}

function parseGitConfigValue(raw: string): string {
  let out = ""
  let quoted = false
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index)
    if (char === "\\" && index + 1 < raw.length) {
      out += raw.charAt(index + 1)
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (char === "#" || char === ";")) break
    out += char
  }
  return out.trim()
}

/** `remote.origin.url` from raw `.git/config` text, falling back to the first remote. */
export function parseOriginUrlFromGitConfig(configText: string): string | null {
  let section: string | null = null
  let originUrl: string | null = null
  let firstRemoteUrl: string | null = null
  const joined = configText.replace(/\\\r?\n[ \t]*/g, "")
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue
    const header = /^\[\s*remote(?:\s+"([^"]+)"|\.([^\]\s]+))\s*\](?:\s*[#;].*)?$/i.exec(line)
    if (header) {
      section = header[1] ?? header[2]?.toLowerCase() ?? null
      continue
    }
    if (line.startsWith("[")) {
      section = null
      continue
    }
    if (section === null) continue
    const match = /^url\s*=\s*(.*)$/i.exec(line)
    if (!match) continue
    const url = parseGitConfigValue(match[1] ?? "")
    if (url.length === 0) continue
    if (section === "origin") originUrl ??= url
    else firstRemoteUrl ??= url
  }
  return originUrl ?? firstRemoteUrl
}

export function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? ""
  if (trimmed.length === 0) return null
  const match =
    /^(?:git@github\.com:|ssh:\/\/(?:git@)?github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    )
  const repository = match?.[1]?.trim() ?? ""
  return repository.length > 0 ? repository : null
}

/**
 * Reads `.git` directly instead of spawning git. A `.git` file pointing into `worktrees/` is a linked
 * worktree, whose history belongs to the main checkout; submodules (`modules/`) count as repositories.
 */
export async function readGitIdentity(fs: SessionHistoryFs, directory: string): Promise<GitIdentity> {
  const gitPath = join(directory, ".git")
  const gitStats = await statOrNull(fs, gitPath)
  if (gitStats === null) return { _tag: "NotGit" }
  let gitDir = gitPath
  if (gitStats.type !== "Directory") {
    const pointer = await readFileStringOrEmpty(fs, gitPath)
    const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim()
    if (target === undefined || target.length === 0) return { _tag: "NotGit" }
    gitDir = resolve(directory, target)
    if (/[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitDir)) return { _tag: "Worktree" }
  }
  const originUrl = parseOriginUrlFromGitConfig(await readFileStringOrEmpty(fs, join(gitDir, "config")))
  return {
    _tag: "Repository",
    git: {
      remoteKey: originUrl === null ? null : normalizeGitRemoteUrl(originUrl),
      repository: parseGitHubRepositoryNameWithOwnerFromRemoteUrl(originUrl),
    },
  }
}
