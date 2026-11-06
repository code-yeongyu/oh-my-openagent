import { join } from "node:path"
import { readFile, writeFile } from "../fs/resilient"
import type { GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"
import { restampContent } from "../tools/claim-frontmatter"
import { LINK_REPAIR_TRAILER, literalPathspecRunner, runCommit, type Run } from "./completion-repair"
import { ARCHIVE_PATH, repointLinks, type Successor } from "./link-rewrite"

/**
 * A run that deletes, archives or moves a note must not leave other notes linking to the old path (#12642). After the
 * completion screen has settled which paths the run really changes, every `[[path]]` and relative markdown link to a
 * path the run removed is rewritten in one extra commit on the run's branch, so the fix lands with the run that broke
 * it. A moved note's links follow it (and its own relative links keep their targets); a removed path that the run
 * recorded in `ARCHIVE.md` points at the archive; any other removed path (a forgotten, sensitive or junk note) becomes
 * plain text. Notes in `skip` (entries the screen dropped and restored to the base) are left as they are, so validating
 * the same tip again finds nothing to repair. Returns the new tip, or `tipSha` when nothing pointed at a removed path.
 */
export async function repointLinksToRemovedPaths(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
  skip: ReadonlySet<string>,
): Promise<string> {
  const run = literalPathspecRunner(exec, dir)
  const tree = await listTree(run, tipSha)
  const live = new Set(tree.map((entry) => entry.path))
  const { removed, movedFrom } = await removedPaths(run, baseSha, tipSha, live)
  if (removed.size === 0) return tipSha

  const changed: string[] = []
  for (const { path } of tree.filter((entry) => entry.regular && entry.path.endsWith(".md") && !skip.has(entry.path))) {
    const current = await readFile(join(dir, path), "utf8")
    const next = repointLinks(path, current, { live, removed }, movedFrom.get(path))
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
    "commit", "-q", "--no-verify", "-m", `chore(memory): repoint links to removed notes\n\n${LINK_REPAIR_TRAILER}: 1`,
  ])
  return (await must(run, ["rev-parse", "--verify", "HEAD"])).trim()
}

/**
 * The paths only the gate's link repair changed: written by its repair commit and untouched by the run itself. A
 * targeted run (`/dream --to <doc>`) is still judged by what the model changed, so these do not count against it.
 */
export async function linkRepairOnlyPaths(exec: GitExec, dir: string, baseSha: string, tipSha: string): Promise<string[]> {
  const run = literalPathspecRunner(exec, dir)
  const own = await runCommit(run, baseSha, tipSha)
  if (own === tipSha) return []
  const names = async (range: string): Promise<string[]> =>
    (await must(run, ["diff", "--name-only", "-z", range, "--"])).split("\0").filter(Boolean)
  const byRun = new Set(await names(`${baseSha}..${own}`))
  return (await names(`${own}..${tipSha}`)).filter((path) => !byRun.has(path))
}

/** The same provenance rule every writer and the commit hook apply; a note whose header does not parse keeps its bytes. */
function restamped(current: string, next: string): string {
  if (!FRONTMATTER_RE.test(current)) return next
  try {
    return restampContent(current, next, undefined)
  } catch (error) {
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

async function removedPaths(
  run: Run,
  baseSha: string,
  tipSha: string,
  live: ReadonlySet<string>,
): Promise<{ removed: Map<string, Successor>; movedFrom: Map<string, string> }> {
  const out = await must(run, ["diff", "--name-status", "-M", "-z", `${baseSha}..${tipSha}`, "--"])
  const parts = out.split("\0")
  const archived = live.has(ARCHIVE_PATH) ? await archiveAdditions(run, baseSha, tipSha) : ""
  const removed = new Map<string, Successor>()
  const movedFrom = new Map<string, string>()
  for (let index = 0; index < parts.length; ) {
    const status = parts[index] ?? ""
    if (status === "") break
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[index + 1]
      const to = parts[index + 2]
      if (status.startsWith("R") && from !== undefined && to !== undefined && !live.has(from)) {
        removed.set(from, { kind: "moved", path: to })
        movedFrom.set(to, from)
      }
      index += 3
      continue
    }
    const path = parts[index + 1]
    if (status === "D" && path !== undefined && !live.has(path)) {
      removed.set(path, recordedIn(archived, path) ? { kind: "archived" } : { kind: "removed" })
    }
    index += 2
  }
  return { removed, movedFrom }
}

/** The lines this run added to `ARCHIVE.md`; only a path named there was archived rather than deleted. */
async function archiveAdditions(run: Run, baseSha: string, tipSha: string): Promise<string> {
  const out = await must(run, ["diff", "-U0", "--no-color", baseSha, tipSha, "--", ARCHIVE_PATH])
  return out.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n")
}

function recordedIn(archived: string, path: string): boolean {
  const stem = path.replace(/\.md$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^\\w./-])${stem}(\\.md)?(?![\\w/-])`).test(archived)
}

async function must(run: Run, argv: readonly string[]): Promise<string> {
  const result = await run(argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result.stdout
}
