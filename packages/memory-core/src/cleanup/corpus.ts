// The live corpus the cleanup planner reads: every memory content note that parses, with its paragraphs and the
// repository paths its wikilinks resolve to. ARCHIVE.md, notes/ and unparsable files are never candidates.

import { readFile, readdir } from "../fs/resilient"
import { join, posix } from "node:path"

import { withoutFences } from "../audit/audit"
import { memoryExpiresAtMs } from "../memfs/expiry"
import { FrontmatterError, parseMemoryFile, type MemoryFrontmatter, type ParsedMemoryFile } from "../memfs/frontmatter"
import { FRONTMATTER_RE, decodeScalarSource } from "../memfs/frontmatter-scalar"
import { isMemoryContentPath } from "../memfs/paths"
import { bodyKey, digest, splitParagraphs, type Paragraph } from "./text"

export interface NoteLink {
  /** Repository path the wikilink resolves to. */
  readonly target: string
  /** 1-based line in the file. */
  readonly line: number
  /** The line as written, trimmed, for evidence. */
  readonly text: string
}

export interface CleanupNote {
  readonly path: string
  readonly content: string
  /** sha256 prefix of `content`; apply refuses a plan whose notes changed since it was written. */
  readonly contentHash: string
  readonly frontmatter: MemoryFrontmatter
  readonly body: string
  readonly bodyKey: string
  readonly bytes: number
  readonly paragraphs: readonly Paragraph[]
  readonly links: readonly NoteLink[]
  readonly expiresAtMs: number | undefined
  readonly readOnly: boolean
}

export interface SkippedFile {
  readonly path: string
  readonly reason: string
}

export interface CleanupCorpus {
  readonly notes: ReadonlyMap<string, CleanupNote>
  /** Every file in the repository (content or not), for link resolution. */
  readonly files: ReadonlySet<string>
  /** Notes linking to each note. */
  readonly inbound: ReadonlyMap<string, ReadonlySet<string>>
  readonly skipped: readonly SkippedFile[]
}

export async function scanCleanupCorpus(repoDir: string): Promise<CleanupCorpus> {
  const files = await listFiles(repoDir)
  const existing = new Set(files)
  const notes = new Map<string, CleanupNote>()
  const skipped: SkippedFile[] = []
  for (const path of files) {
    if (!isMemoryContentPath(path) || path.startsWith("memory/")) continue
    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(repoDir, path)))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      skipped.push({ path, reason: error instanceof TypeError ? "invalid UTF-8" : "cannot read file" })
      continue
    }
    let parsed: ParsedMemoryFile
    try {
      parsed = parseMemoryFile(content)
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error
      skipped.push({ path, reason: error.message })
      continue
    }
    const body = parsed.body
    notes.set(path, {
      path,
      content,
      contentHash: digest(content),
      frontmatter: parsed.frontmatter,
      body,
      bodyKey: bodyKey(body),
      bytes: Buffer.byteLength(content, "utf8"),
      paragraphs: splitParagraphs(body),
      links: wikilinks(path, content, existing),
      expiresAtMs: memoryExpiresAtMs(parsed.frontmatter),
      readOnly: decodeScalarSource(parsed.frontmatter.read_only ?? "") === "true",
    })
  }
  const inbound = new Map<string, Set<string>>()
  for (const note of notes.values()) {
    for (const link of note.links) {
      if (link.target === note.path) continue
      const sources = inbound.get(link.target) ?? new Set<string>()
      sources.add(note.path)
      inbound.set(link.target, sources)
    }
  }
  return { notes, files: existing, inbound, skipped }
}

/** The audit's wikilink resolution: an existing file, the implied `.md`, never a directory or an escaping path. */
export function resolveWikilink(rawTarget: string, files: ReadonlySet<string>): string | undefined {
  const target = (rawTarget.split("|")[0] ?? "").split("#")[0]?.trim() ?? ""
  if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || posix.isAbsolute(target)) return undefined
  const resolved = posix.normalize(target)
  if (resolved === ".." || resolved.startsWith("../")) return undefined
  if (files.has(resolved)) return resolved
  return files.has(`${resolved}.md`) ? `${resolved}.md` : undefined
}

/** The file's lines with fenced and inline code blanked (header kept), 1:1 with the file so indexes are line numbers. */
export function scannableLines(content: string): readonly string[] {
  const match = FRONTMATTER_RE.exec(content)
  if (match === null) return withoutFences(content).split("\n")
  const body = match[2] ?? ""
  const header = content.slice(0, content.length - body.length)
  const headerLines = header.split("\n")
  if (header.endsWith("\n")) headerLines.pop()
  return [...headerLines, ...withoutFences(body).split("\n")]
}

function wikilinks(path: string, content: string, files: ReadonlySet<string>): NoteLink[] {
  const links: NoteLink[] = []
  scannableLines(content).forEach((line, index) => {
    for (const found of line.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const target = resolveWikilink(found[1] ?? "", files)
      if (target !== undefined && target !== path) links.push({ target, line: index + 1, text: line.trim() })
    }
  })
  return links
}

async function listFiles(root: string, dir = ""): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(join(root, dir), { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".tmp" || entry.isSymbolicLink()) continue
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}
