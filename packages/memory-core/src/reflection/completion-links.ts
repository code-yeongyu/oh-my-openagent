import { join, posix } from "node:path"
import { readFile, writeFile } from "../fs/resilient"
import type { GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"
import { restampContent } from "../tools/claim-frontmatter"
import { literalPathspecRunner, type Run } from "./completion-repair"

const ARCHIVE_PATH = "ARCHIVE.md"

type Successor = { readonly kind: "moved"; readonly path: string } | { readonly kind: "archived" } | { readonly kind: "removed" }

interface LinkTargets {
  readonly live: ReadonlySet<string>
  readonly removed: ReadonlyMap<string, Successor>
}

/**
 * A run that deletes, archives or moves a note must not leave other notes linking to the old path (#12642). Before
 * the completion screen, every `[[path]]` and relative markdown link that resolved at the base and points at a path
 * this run removed is rewritten in one extra commit on the run's branch, so the fix lands with the run that broke it:
 * a moved note's links follow it, a note removed in a run that wrote `ARCHIVE.md` points at the archive, and any
 * other removed note's links become their plain text. Links in fenced or inline code are examples, never rewritten.
 * The worktree is clean at `tipSha` (the caller checked). Returns the new tip, or `tipSha` when nothing pointed there.
 */
export async function repointLinksToRemovedPaths(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
): Promise<string> {
  const run = literalPathspecRunner(exec, dir)
  const tree = await listTree(run, tipSha)
  const live = new Set(tree.map((entry) => entry.path))
  const removed = await removedPaths(run, baseSha, tipSha, live)
  if (removed.size === 0) return tipSha

  const changed: string[] = []
  for (const { path } of tree.filter((entry) => entry.regular && entry.path.endsWith(".md"))) {
    const current = await readFile(join(dir, path), "utf8")
    const next = repointLinks(path, current, { live, removed })
    if (next === current) continue
    await writeFile(join(dir, path), restamped(current, next), "utf8")
    changed.push(path)
  }
  if (changed.length === 0) return tipSha

  await must(run, ["add", "--", ...changed])
  const [name = "reflection", email = "reflection@omo.local"] =
    (await must(run, [...STABLE_LOG_OUTPUT, "log", "-1", "--format=%an%n%ae", tipSha])).split("\n")
  await must(run, [
    "-c", `user.name=${name}`, "-c", `user.email=${email}`,
    "commit", "-q", "--no-verify", "-m", "chore(memory): repoint links to removed notes",
  ])
  return (await must(run, ["rev-parse", "--verify", "HEAD"])).trim()
}

/** The same provenance rule every writer and the commit hook apply; a note whose header does not parse keeps its bytes. */
function restamped(current: string, next: string): string {
  if (!FRONTMATTER_RE.test(current)) return next
  try {
    return restampContent(current, next, undefined)
  } catch (error) {
    // The header is invalid at the tip already; the completion screen judges that note on its own, unchanged here.
    if (error instanceof Error) return next
    throw error
  }
}

async function listTree(run: Run, tipSha: string): Promise<{ path: string; regular: boolean }[]> {
  const out = await must(run, ["ls-tree", "-r", "-z", "--full-tree", tipSha])
  return out.split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t")
    const [mode = ""] = line.slice(0, tab).split(" ")
    return { path: line.slice(tab + 1), regular: mode === "100644" || mode === "100755" }
  })
}

async function removedPaths(run: Run, baseSha: string, tipSha: string, live: ReadonlySet<string>): Promise<Map<string, Successor>> {
  const out = await must(run, ["diff", "--name-status", "-M", "-z", `${baseSha}..${tipSha}`, "--"])
  const parts = out.split("\0")
  const archiveWritten = live.has(ARCHIVE_PATH) && (await run(["diff", "--quiet", baseSha, tipSha, "--", ARCHIVE_PATH])).code === 1
  const removed = new Map<string, Successor>()
  for (let index = 0; index < parts.length; ) {
    const status = parts[index] ?? ""
    if (status === "") break
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[index + 1]
      const to = parts[index + 2]
      if (status.startsWith("R") && from !== undefined && to !== undefined && !live.has(from)) {
        removed.set(from, { kind: "moved", path: to })
      }
      index += 3
      continue
    }
    const path = parts[index + 1]
    if (status === "D" && path !== undefined && !live.has(path)) {
      removed.set(path, archiveWritten ? { kind: "archived" } : { kind: "removed" })
    }
    index += 2
  }
  return removed
}

function repointLinks(path: string, content: string, targets: LinkTargets): string {
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
    // Inline code spans quote link syntax as an example, so only the text between them is rewritten.
    let out = ""
    let last = 0
    for (const span of line.matchAll(/(`+)[^`]*?\1/g)) {
      out += repointSegment(path, line.slice(last, span.index), targets) + span[0]
      last = span.index + span[0].length
    }
    return out + repointSegment(path, line.slice(last), targets)
  }).join("\n")
  return content.slice(0, bodyStart) + body
}

function repointSegment(path: string, text: string, targets: LinkTargets): string {
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
    const resolved = posix.normalize(posix.join(posix.dirname(path), destinationPath))
    if (escapes(resolved) || resolves(resolved, targets.live, false)) return whole
    const successor = targets.removed.get(resolved)
    if (successor === undefined) return whole
    if (successor.kind === "removed") return label
    const next = posix.relative(posix.dirname(path), successor.kind === "moved" ? successor.path : ARCHIVE_PATH)
    const anchor = successor.kind === "moved" && anchorParts.length > 0 ? `#${anchorParts.join("#")}` : ""
    const replaced = /\s/.test(next) && !raw.trim().startsWith("<") ? `<${next}${anchor}>` : `${next}${anchor}`
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

async function must(run: Run, argv: readonly string[]): Promise<string> {
  const result = await run(argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result.stdout
}
