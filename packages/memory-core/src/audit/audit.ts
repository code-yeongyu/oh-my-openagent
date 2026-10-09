import { createHash } from "node:crypto"
import { readFile, readdir } from "../fs/resilient"
import { join, posix } from "node:path"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"
import { describeFrontmatterViolation } from "../memfs/frontmatter-validation"
import { isMemoryContentPath } from "../memfs/paths"

export type MemoryAuditCode =
  | "link_dangling" | "frontmatter_invalid" | "content_duplicate"
  | "path_orphan" | "file_unreadable" | "system_pressure"

export interface MemoryAuditIssue {
  readonly code: MemoryAuditCode
  readonly path: string
  readonly detail: string
  readonly related?: readonly string[]
}

export interface MemoryAuditReport {
  readonly version: 1
  readonly generatedAt: string
  readonly issues: readonly MemoryAuditIssue[]
  readonly counts: Readonly<Record<MemoryAuditCode, number>>
}

export interface MemoryAuditOptions {
  readonly systemTokens?: { readonly totalTokens: number }
  readonly budgetTokens?: number
}

const HOMES = new Set(["system", "reference", "notes", "people", "skills"])
/** The legacy layout nests the same homes under `memory/`, as `isMemoryContentPath` and the hook accept. */
const LEGACY_PREFIX = "memory/"
const ROOT_FILES = new Set(["ARCHIVE.md", "README.md"])

/** Read the working corpus, including a maintenance worktree, without following symlinks. */
export async function auditMemoryRepo(
  repoDir: string,
  options: MemoryAuditOptions = {},
): Promise<MemoryAuditReport> {
  const files = await listFiles(repoDir)
  const existing = new Set(files)
  const issues: MemoryAuditIssue[] = []
  const bodies = new Map<string, string[]>()

  for (const path of files.filter((file) => file.endsWith(".md"))) {
    const homePath = path.startsWith(LEGACY_PREFIX) ? path.slice(LEGACY_PREFIX.length) : path
    if (!HOMES.has(homePath.split("/")[0] ?? "") && !ROOT_FILES.has(path)) {
      issues.push({ code: "path_orphan", path, detail: "outside memory homes" })
    }
    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(repoDir, path)))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (!(error instanceof TypeError) && !("code" in error)) throw error
      issues.push({ code: "file_unreadable", path, detail: error instanceof TypeError ? "invalid UTF-8" : "cannot read file" })
      continue
    }
    if (isMemoryContentPath(path)) {
      const violation = describeFrontmatterViolation(content)
      if (violation !== null) issues.push({ code: "frontmatter_invalid", path, detail: violation })
    }
    const body = FRONTMATTER_RE.exec(content)?.[2] ?? content
    if (body.trim() !== "") {
      const hash = createHash("sha256").update(body).digest("hex")
      const group = bodies.get(hash)
      if (group) group.push(path)
      else bodies.set(hash, [path])
    }
    issues.push(...danglingLinks(path, body, existing))
  }

  for (const paths of bodies.values()) {
    if (paths.length < 2) continue
    const canonical = paths[0]
    if (canonical === undefined) continue
    for (const path of paths.slice(1)) {
      issues.push({ code: "content_duplicate", path, detail: `same body as ${canonical}`, related: paths })
    }
  }
  const tokens = options.systemTokens?.totalTokens
  const budget = options.budgetTokens
  if (tokens !== undefined && budget !== undefined && tokens >= 0.8 * budget) {
    issues.push({ code: "system_pressure", path: "system/", detail: `${tokens} tokens of ${budget} budget` })
  }
  const counts: Record<MemoryAuditCode, number> = {
    link_dangling: 0, frontmatter_invalid: 0, content_duplicate: 0,
    path_orphan: 0, file_unreadable: 0, system_pressure: 0,
  }
  for (const issue of issues) counts[issue.code]++
  return { version: 1, generatedAt: new Date().toISOString(), issues, counts }
}

async function listFiles(root: string, dir = ""): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(join(root, dir), { withFileTypes: true })
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".tmp" || entry.isSymbolicLink()) continue
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

function danglingLinks(path: string, body: string, existing: ReadonlySet<string>): MemoryAuditIssue[] {
  const issues: MemoryAuditIssue[] = []
  const text = withoutFences(body)
  const targets = [
    ...[...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => ({ raw: match[1] ?? "", wiki: true })),
    ...[...text.matchAll(/(?<!!)\[[^\]\n]*\]\((<?[^)\n]+>?)\)/g)].map((match) => ({ raw: match[1] ?? "", wiki: false })),
  ]
  for (const { raw, wiki } of targets) {
    const target = (wiki ? raw.split("|")[0] ?? "" : markdownDestination(raw)).split("#")[0]?.trim() ?? ""
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue
    const resolved = posix.normalize(wiki ? target : posix.join(posix.dirname(path), target))
    const escapes = posix.isAbsolute(target) || resolved === ".." || resolved.startsWith("../")
    if (!escapes && (existing.has(resolved) || (wiki && existing.has(`${resolved}.md`)) || isDirectory(resolved, existing))) continue
    issues.push({ code: "link_dangling", path, detail: escapes ? `${target} (escapes repository)` : target })
  }
  return issues
}

/** The destination of a markdown link: `<a b.md>` keeps its spaces, otherwise a space ends it (a title follows). */
function markdownDestination(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("<")) return trimmed.slice(1, trimmed.indexOf(">") === -1 ? undefined : trimmed.indexOf(">"))
  return trimmed.split(/\s+/)[0] ?? ""
}

function isDirectory(resolved: string, existing: ReadonlySet<string>): boolean {
  const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`
  for (const file of existing) if (file.startsWith(prefix)) return true
  return false
}

function withoutFences(body: string): string {
  let fence: { readonly char: string; readonly length: number } | undefined
  return body.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker?.[1]?.[0] === fence.char && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined
      return ""
    }
    if (marker?.[1]) {
      fence = { char: marker[1][0] ?? "", length: marker[1].length }
      return ""
    }
    // inline code spans quote link syntax as an example, not a reference
    return line.replace(/(`+)[^`]*?\1/g, "")
  }).join("\n")
}
