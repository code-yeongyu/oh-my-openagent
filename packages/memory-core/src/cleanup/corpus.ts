// The live corpus the cleanup planner reads: every memory content note that parses, with its paragraphs and the
// repository paths its wikilinks and markdown links resolve to. ARCHIVE.md, notes/, the legacy memory/ layout and
// unparsable files are never candidates, but every markdown file's links are read so that apply can repoint (or hold for) each one.

import { readFile, readdir } from "../fs/resilient"
import { join, posix } from "node:path"

import { markdownDestination, withoutFences } from "../audit/audit"
import { ARCHIVE_PATH } from "../reflection/link-rewrite"
import { memoryExpiresAtMs } from "../memfs/expiry"
import { FrontmatterError, parseMemoryFile, type MemoryFrontmatter, type ParsedMemoryFile } from "../memfs/frontmatter"
import { FRONTMATTER_RE, decodeScalarSource } from "../memfs/frontmatter-scalar"
import { isMemoryContentPath } from "../memfs/paths"
import { bodyKey, digest, splitParagraphs, type Paragraph } from "./text"

export interface NoteLink {
  /** Repository path the wikilink or markdown link resolves to. */
  readonly target: string
  /** 1-based line in the file. */
  readonly line: number
  /** The line as written, trimmed, for evidence. */
  readonly text: string
}

/** A markdown file whose links apply may repoint: a candidate note, or a file outside the candidates (notes/, README). */
export interface LinkingFile {
  readonly path: string
  readonly content: string
  /** sha256 prefix of `content`; apply refuses a plan whose files changed since it was written. */
  readonly contentHash: string
  readonly links: readonly NoteLink[]
  readonly readOnly: boolean
}

export interface CleanupNote extends LinkingFile {
  readonly frontmatter: MemoryFrontmatter
  readonly body: string
  readonly bodyKey: string
  readonly bytes: number
  readonly paragraphs: readonly Paragraph[]
  readonly expiresAtMs: number | undefined
}

export interface SkippedFile {
  readonly path: string
  readonly reason: string
}

export interface CleanupCorpus {
  readonly notes: ReadonlyMap<string, CleanupNote>
  /** Every readable markdown file but ARCHIVE.md, the notes included. */
  readonly linking: ReadonlyMap<string, LinkingFile>
  /** Every file in the repository (content or not), for link resolution. */
  readonly files: ReadonlySet<string>
  /** Files linking to each note. */
  readonly inbound: ReadonlyMap<string, ReadonlySet<string>>
  readonly skipped: readonly SkippedFile[]
  /** Content notes in the legacy `memory/` layout, which are never candidates. */
  readonly legacy: readonly string[]
}

export async function scanCleanupCorpus(repoDir: string): Promise<CleanupCorpus> {
  const files = await listFiles(repoDir)
  const existing = new Set(files)
  const notes = new Map<string, CleanupNote>()
  const linking = new Map<string, LinkingFile>()
  const skipped: SkippedFile[] = []
  const legacy: string[] = []
  for (const path of files) {
    if (!path.endsWith(".md") || path === ARCHIVE_PATH) continue
    if (isMemoryContentPath(path) && path.startsWith("memory/")) legacy.push(path)
    const candidate = isMemoryContentPath(path) && !path.startsWith("memory/")
    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(repoDir, path)))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (candidate) skipped.push({ path, reason: error instanceof TypeError ? "invalid UTF-8" : "cannot read file" })
      continue
    }
    let parsed: ParsedMemoryFile | undefined
    try {
      parsed = parseMemoryFile(content)
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error
      if (candidate) skipped.push({ path, reason: error.message })
    }
    const file: LinkingFile = {
      path,
      content,
      contentHash: digest(content),
      links: linksOf(path, content, existing),
      readOnly: parsed !== undefined && decodeScalarSource(parsed.frontmatter.read_only ?? "") === "true",
    }
    linking.set(path, file)
    if (!candidate || parsed === undefined) continue
    const body = parsed.body
    notes.set(path, {
      ...file,
      frontmatter: parsed.frontmatter,
      body,
      bodyKey: bodyKey(body),
      bytes: Buffer.byteLength(content, "utf8"),
      paragraphs: splitParagraphs(body),
      expiresAtMs: memoryExpiresAtMs(parsed.frontmatter),
    })
  }
  const inbound = new Map<string, Set<string>>()
  for (const file of linking.values()) {
    for (const link of file.links) {
      const sources = inbound.get(link.target) ?? new Set<string>()
      sources.add(file.path)
      inbound.set(link.target, sources)
    }
  }
  return { notes, linking, files: existing, inbound, skipped, legacy }
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

/** Every link apply's repoint can rewrite: wikilinks from the root, markdown links from the note's own folder. */
function linksOf(path: string, content: string, files: ReadonlySet<string>): NoteLink[] {
  const links: NoteLink[] = []
  scannableLines(content).forEach((line, index) => {
    const targets = [
      ...[...line.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((found) => resolveWikilink(found[1] ?? "", files)),
      ...[...line.matchAll(/(?<!!)\[[^\]\n]*\]\((<?[^)\n]+>?)\)/g)].map((found) =>
        resolveMarkdownLink(path, found[1] ?? "", files),
      ),
    ]
    for (const target of targets)
      if (target !== undefined && target !== path) links.push({ target, line: index + 1, text: line.trim() })
  })
  return links
}

function resolveMarkdownLink(path: string, raw: string, files: ReadonlySet<string>): string | undefined {
  const destination = markdownDestination(raw).split("#")[0] ?? ""
  if (destination === "" || /^[a-z][a-z0-9+.-]*:/i.test(destination) || posix.isAbsolute(destination)) return undefined
  const resolved = posix.normalize(posix.join(posix.dirname(path), destination))
  if (resolved === ".." || resolved.startsWith("../")) return undefined
  return files.has(resolved) ? resolved : undefined
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
