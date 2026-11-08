import { posix } from "node:path"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"

export const ARCHIVE_PATH = "ARCHIVE.md"

/** Where a link to a path the run removed points now: the rename destination, the root archive, or nowhere. */
export type Successor = { readonly kind: "moved"; readonly path: string } | { readonly kind: "archived" } | { readonly kind: "removed" }

export interface LinkTargets {
  readonly live: ReadonlySet<string>
  readonly removed: ReadonlyMap<string, Successor>
}

/**
 * Rewrites the body links of the note at `path` that would dangle after the run: links to a removed path go to its
 * successor, and when the note itself was moved from `movedFrom`, its relative markdown links are re-resolved from
 * the old folder so they keep their targets. Fenced and inline code is quoted example text and stays as written.
 */
export function repointLinks(path: string, content: string, targets: LinkTargets, movedFrom?: string): string {
  const match = FRONTMATTER_RE.exec(content)
  const bodyStart = match === null ? 0 : content.length - (match[2] ?? "").length
  let fence: { readonly char: string; readonly length: number } | undefined
  const body = content.slice(bodyStart).split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence !== undefined) {
      if (marker?.[1]?.[0] === fence.char && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined
      return line
    }
    if (marker?.[1] !== undefined) {
      fence = { char: marker[1][0] ?? "", length: marker[1].length }
      return line
    }
    let out = ""
    let last = 0
    for (const span of line.matchAll(/(`+)[^`]*?\1/g)) {
      out += repointSegment(path, line.slice(last, span.index), targets, movedFrom) + span[0]
      last = span.index + span[0].length
    }
    return out + repointSegment(path, line.slice(last), targets, movedFrom)
  }).join("\n")
  return content.slice(0, bodyStart) + body
}

function repointSegment(path: string, text: string, targets: LinkTargets, movedFrom: string | undefined): string {
  const wiki = text.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const [targetPart = "", ...aliasParts] = inner.split("|")
    const alias = aliasParts.length > 0 ? aliasParts.join("|") : undefined
    const [rawTarget = "", ...anchorParts] = targetPart.split("#")
    const target = rawTarget.trim()
    const anchor = anchorParts.length > 0 ? `#${anchorParts.join("#")}` : ""
    if (!isRepoRelative(target)) return whole
    const resolved = posix.normalize(target)
    if (escapes(resolved) || resolves(resolved, targets.live, true)) return whole
    const exact = targets.removed.get(resolved)
    const successor = exact ?? targets.removed.get(`${resolved}.md`)
    if (successor === undefined) return whole
    const suffix = alias === undefined ? "" : `|${alias}`
    switch (successor.kind) {
      case "moved": return `[[${exact === undefined ? successor.path.replace(/\.md$/, "") : successor.path}${anchor}${suffix}]]`
      case "archived": return `[[${ARCHIVE_PATH}|${alias ?? target} (archived)]]`
      case "removed": return alias ?? target
    }
  })
  return wiki.replace(/(?<!!)\[([^\]\n]*)\]\((<?[^)\n]+>?)\)/g, (whole, label: string, raw: string) => {
    const destination = markdownDestination(raw)
    const [destinationPath = "", ...anchorParts] = destination.split("#")
    if (!isRepoRelative(destinationPath)) return whole
    const anchor = anchorParts.length > 0 ? `#${anchorParts.join("#")}` : ""
    // The link's own target is where it resolved when written: from the note's old folder when the note moved.
    const original = posix.normalize(posix.join(posix.dirname(movedFrom ?? path), destinationPath))
    if (escapes(original)) return whole
    const successor = targets.removed.get(original)
    if (successor?.kind === "removed") return label
    const nextTarget = successor === undefined
      ? (resolves(original, targets.live, false) ? original : undefined)
      : successor.kind === "moved" ? successor.path : ARCHIVE_PATH
    if (nextTarget === undefined || nextTarget === posix.normalize(posix.join(posix.dirname(path), destinationPath))) return whole
    const next = `${posix.relative(posix.dirname(path), nextTarget)}${successor?.kind === "archived" ? "" : anchor}`
    const replaced = /\s/.test(next) && !raw.trim().startsWith("<") ? `<${next}>` : next
    return `[${label}](${raw.replace(destination, replaced)})`
  })
}

function isRepoRelative(target: string): boolean {
  return target !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !posix.isAbsolute(target)
}

function escapes(resolved: string): boolean {
  return resolved === ".." || resolved.startsWith("../")
}

/** The audit's resolution rule: an existing file, a wiki link's implied `.md`, or a directory prefix. */
function resolves(resolved: string, live: ReadonlySet<string>, wiki: boolean): boolean {
  if (live.has(resolved) || (wiki && live.has(`${resolved}.md`))) return true
  const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`
  for (const file of live) if (file.startsWith(prefix)) return true
  return false
}

/** The destination of a markdown link: `<a b.md>` keeps its spaces, otherwise a space ends it (a title follows). */
function markdownDestination(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("<")) return trimmed.slice(1, trimmed.indexOf(">") === -1 ? undefined : trimmed.indexOf(">"))
  return trimmed.split(/\s+/)[0] ?? ""
}
