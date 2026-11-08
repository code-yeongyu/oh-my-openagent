import { join, posix } from "node:path"
import { writeFile } from "../fs/resilient"
import type { GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"
import { describeFrontmatterViolation } from "../memfs/frontmatter-validation"
import { isMemoryContentPath } from "../memfs/paths"
import { scanSecretLikeMaterial } from "../sync/redact"
import { restampContent } from "../tools/claim-frontmatter"
import { literalPathspecRunner, readDroppedTrailers, type Run } from "./completion-repair"
import { listTree, must, removedPaths } from "./link-removals"
import { repointLinks } from "./link-rewrite"

/** The gate's link-repair commit sitting on a run tip, recognised by recomputing it (#12642). */
export interface RecognizedLinkRepair {
  readonly tipSha: string
  readonly runTip: string
  readonly writes: ReadonlyMap<string, string>
}

export interface LinkRepair {
  readonly tipSha: string
  /** Paths only the repair wrote: notes the run itself never changed. */
  readonly linkRepairs: readonly string[]
}

/**
 * Whether `tipSha` is the gate's own link repair of its parent. Nothing the run writes (a trailer, a subject, an
 * author) is trusted: the repair is recomputed from the parent, and the tip counts only when it changes exactly the
 * notes that recomputation rewrites, to exactly that content. A run commit that also edits anything else, or edits a
 * note differently, is the run's own work and stays the run's.
 */
export async function recognizeLinkRepair(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
): Promise<RecognizedLinkRepair | undefined> {
  const run = literalPathspecRunner(exec, dir)
  const parents = (await must(run, ["rev-list", "--parents", "-n", "1", tipSha])).trim().split(/\s+/).slice(1)
  const runTip = parents[0]
  if (parents.length !== 1 || runTip === undefined || runTip === baseSha) return undefined
  if ((await run(["merge-base", "--is-ancestor", baseSha, runTip])).code !== 0) return undefined
  const changed = (await must(run, ["diff", "--name-status", "--no-renames", "-z", runTip, tipSha, "--"])).split("\0").filter(Boolean)
  const paths = changed.filter((_, index) => index % 2 === 1)
  if (paths.length === 0 || changed.some((entry, index) => index % 2 === 0 && entry !== "M")) return undefined
  const skip = new Set((await readDroppedTrailers(exec, dir, baseSha, runTip)).map((entry) => entry.path))
  const writes = await planLinkRepair(run, baseSha, runTip, skip)
  if (writes.size !== paths.length) return undefined
  for (const path of paths) {
    const planned = writes.get(path)
    if (planned === undefined || (await blob(run, tipSha, path)) !== planned) return undefined
  }
  return { tipSha, runTip, writes }
}

/**
 * A run that deletes, archives or moves a note must not leave other notes linking to the old path (#12642). On the
 * screened run tip (HEAD, clean), every link to a path the run removed is rewritten in one extra commit, so the fix
 * lands with the run that broke it. The content is screened here, before it is written: a note whose rewrite would be
 * refused (secret-like text it already held, a header the screen rejects) is left as it is, so the completion screen
 * never runs on the repair and never drops or squashes it. `prior` is a repair already recognised on this same tip;
 * when the plan is unchanged that commit is restored instead of recreated, so validating twice gives one result.
 */
export async function applyLinkRepair(
  exec: GitExec,
  dir: string,
  baseSha: string,
  runTip: string,
  dropped: readonly string[],
  prior: RecognizedLinkRepair | undefined,
): Promise<LinkRepair | undefined> {
  const run = literalPathspecRunner(exec, dir)
  const writes = await planLinkRepair(run, baseSha, runTip, new Set(dropped))
  if (writes.size === 0) return undefined
  let tipSha: string
  if (prior !== undefined && prior.runTip === runTip && sameWrites(prior.writes, writes)) {
    await must(run, ["reset", "-q", "--hard", prior.tipSha])
    tipSha = prior.tipSha
  } else {
    for (const [path, content] of writes) await writeFile(join(dir, path), content, "utf8")
    await must(run, ["add", "--", ...writes.keys()])
    const [name = "reflection", email = "reflection@omo.local"] =
      (await must(run, [...STABLE_LOG_OUTPUT, "log", "-1", "--format=%an%n%ae", runTip])).split("\n")
    await must(run, [
      "-c", `user.name=${name}`, "-c", `user.email=${email}`,
      "commit", "-q", "--no-verify", "-m", "chore(memory): repoint links to removed notes",
    ])
    tipSha = (await must(run, ["rev-parse", "--verify", "HEAD"])).trim()
  }
  const byRun = new Set((await must(run, ["diff", "--name-only", "-z", `${baseSha}..${runTip}`, "--"])).split("\0").filter(Boolean))
  return { tipSha, linkRepairs: [...writes.keys()].filter((path) => !byRun.has(path)).sort() }
}

async function planLinkRepair(run: Run, baseSha: string, runTip: string, skip: ReadonlySet<string>): Promise<Map<string, string>> {
  const tree = await listTree(run, runTip)
  const live = new Set(tree.map((entry) => entry.path))
  const { removed, movedFrom } = await removedPaths(run, baseSha, runTip, live)
  const writes = new Map<string, string>()
  if (removed.size === 0) return writes
  const notes = new Set(tree.filter((entry) => entry.regular && entry.path.endsWith(".md") && !skip.has(entry.path)).map((entry) => entry.path))
  const candidates = new Set([...movedFrom.keys(), ...(await notesNaming(run, runTip, [...removed.keys()]))])
  for (const path of [...candidates].filter((candidate) => notes.has(candidate)).sort()) {
    const current = await noteText(run, runTip, path)
    if (current === undefined) continue
    const next = repointLinks(path, current, { live, removed }, movedFrom.get(path))
    if (next === current) continue
    const stamped = restamped(current, next)
    if (screenAccepts(path, current, stamped)) writes.set(path, stamped)
  }
  return writes
}

/** Notes whose text holds a removed note's file name; a link to it cannot be written without that name. */
async function notesNaming(run: Run, revision: string, removed: readonly string[]): Promise<string[]> {
  const stems = [...new Set(removed.map((path) => posix.basename(path).replace(/\.md$/, "")).filter(Boolean))]
  if (stems.length === 0) return []
  const result = await run(["grep", "-l", "-z", "-F", ...stems.flatMap((stem) => ["-e", stem]), revision])
  if (result.code === 1) return []
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git grep failed")
  return result.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(revision.length + 1))
}

function screenAccepts(path: string, before: string, after: string): boolean {
  if (scanSecretLikeMaterial(after).length > 0) return false
  if (!isMemoryContentPath(path) || describeFrontmatterViolation(after) === null) return true
  return FRONTMATTER_RE.exec(after)?.[1] === FRONTMATTER_RE.exec(before)?.[1]
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

function sameWrites(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, content]) => b.get(path) === content)
}

const blob = (run: Run, revision: string, path: string): Promise<string> => must(run, ["cat-file", "blob", `${revision}:${path}`])

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** A note's text, or undefined when it is not valid UTF-8: decoding it would rewrite bytes outside its links. */
async function noteText(run: Run, revision: string, path: string): Promise<string | undefined> {
  const result = await run(["cat-file", "blob", `${revision}:${path}`])
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git cat-file blob ${revision}:${path} failed`)
  try {
    return UTF8.decode(result.stdoutBytes ?? Buffer.from(result.stdout, "utf8"))
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}
