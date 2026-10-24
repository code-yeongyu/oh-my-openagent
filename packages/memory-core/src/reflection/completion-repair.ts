import type { GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { redactSecretLikeMaterial } from "../sync/redact"

const GIT_TIMEOUT_MS = 30_000

/**
 * One memory entry the completion gate refused and removed from the run's commit. `path` is the repository path
 * itself (the agent chose it, so it can be secret-shaped): redact it before printing. `reason` never carries the
 * matched value.
 */
export interface DroppedEntry {
  readonly path: string
  readonly reason: string
}

/** The squashed commit records what it left out, so a later validation of the same tip still knows. */
export const DROPPED_TRAILER = "Omo-Completion-Dropped"

/** One line a finalizer can put in the run's detail; every path and reason is redacted here, never printed raw. */
export function describeDroppedEntries(dropped: readonly DroppedEntry[]): string {
  const items = dropped.map((entry) => `${redactSecretLikeMaterial(entry.path)} (${redactSecretLikeMaterial(entry.reason)})`)
  return `Dropped ${dropped.length} invalid memory entr${dropped.length === 1 ? "y" : "ies"}: ${items.join("; ")}`
}

/** JSON keeps any path (a ' | ', a newline) intact on read-back; the values are redacted before they are written. */
const trailerLine = (entry: DroppedEntry): string =>
  `${DROPPED_TRAILER}: ${JSON.stringify({ path: redactSecretLikeMaterial(entry.path), reason: redactSecretLikeMaterial(entry.reason) })}`

function parseTrailerValue(value: string): DroppedEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== "object" || parsed === null) return undefined
    const { path, reason } = parsed as { path?: unknown; reason?: unknown }
    return typeof path === "string" && typeof reason === "string" ? { path, reason } : undefined
  } catch {
    return undefined
  }
}

/**
 * The dropped entries a previous squash recorded on `tipSha`, when the branch is exactly that one commit on
 * the base; empty otherwise. Lets a second validation of an already-repaired tip report what was dropped.
 */
export async function readDroppedTrailers(exec: GitExec, dir: string, baseSha: string, tipSha: string): Promise<DroppedEntry[]> {
  const run = runner(exec, dir)
  const parent = await run(["rev-parse", "--verify", `${tipSha}^`])
  if (parent.code !== 0 || parent.stdout.trim() !== baseSha) return []
  const body = await must(run, [...STABLE_LOG_OUTPUT, "log", "-1", "--format=%B", tipSha])
  const entries: DroppedEntry[] = []
  for (const line of body.split("\n")) {
    if (!line.startsWith(`${DROPPED_TRAILER}: `)) continue
    const entry = parseTrailerValue(line.slice(DROPPED_TRAILER.length + 2))
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

type Run = (argv: readonly string[], env?: Readonly<Record<string, string>>) => Promise<{ code: number; stdout: string; stderr: string }>

/**
 * Every git call here that names a note passes the agent-chosen path as a pathspec. GIT_LITERAL_PATHSPECS makes each
 * one match only that exact path: without it a name such as `k*.md`, `k[e]ep1.md` or `:!x.md` is a glob or magic
 * pathspec, and dropping it would delete or revert OTHER notes.
 */
function runner(exec: GitExec, dir: string): Run {
  return (argv, env) =>
    exec.run(argv, {
      cwd: dir,
      timeoutMs: GIT_TIMEOUT_MS,
      // git refuses literal pathspecs combined with glob/icase ones, so a user's own setting must not fail every drop.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", GIT_GLOB_PATHSPECS: "0", GIT_ICASE_PATHSPECS: "0", GIT_NOGLOB_PATHSPECS: "0", ...env },
    })
}

async function must(run: Run, argv: readonly string[]): Promise<string> {
  const result = await run(argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result.stdout
}

/** destination -> source of every rename in base..tip, so dropping a moved file also undoes the move. */
async function renameSources(run: Run, baseSha: string, tipSha: string): Promise<Map<string, string>> {
  const out = await must(run, ["diff", "--name-status", "-M", "-z", `${baseSha}..${tipSha}`, "--"])
  const parts = out.split("\0")
  const sources = new Map<string, string>()
  for (let index = 0; index < parts.length; ) {
    const status = parts[index] ?? ""
    if (status === "") break
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[index + 1]
      const to = parts[index + 2]
      if (status.startsWith("R") && from !== undefined && to !== undefined) sources.set(to, from)
      index += 3
    } else {
      index += 2
    }
  }
  return sources
}

export async function commitCount(exec: GitExec, dir: string, baseSha: string, tipSha: string): Promise<number> {
  const out = await must(runner(exec, dir), ["rev-list", "--count", `${baseSha}..${tipSha}`])
  return Number.parseInt(out.trim(), 10)
}

/**
 * Rewrite the run's branch as ONE commit on the recorded base that keeps every change except the
 * given paths. Squashing is deliberate: the branch is merged --no-ff with its whole history, so a
 * blob a dropped entry introduced in an earlier commit would otherwise still ride along. A dropped
 * path returns to its base content (or disappears when the base lacked it); when it was the
 * destination of a rename, the rename's source is restored too so no file is lost. Returns the new
 * tip, which is the base itself when nothing is left to keep.
 */
export async function squashWithoutPaths(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
  dropped: ReadonlySet<string>,
  record: readonly DroppedEntry[] = [],
): Promise<string> {
  const run = runner(exec, dir)
  const sources = await renameSources(run, baseSha, tipSha)
  const identity = (await must(run, [...STABLE_LOG_OUTPUT, "log", "-1", "--format=%an%n%ae%n%s", tipSha])).split("\n")
  const restore = new Set(dropped)
  for (const path of dropped) {
    const source = sources.get(path)
    if (source !== undefined) restore.add(source)
  }
  await must(run, ["reset", "--soft", baseSha])
  for (const path of restore) {
    const inBase = (await run(["cat-file", "-e", `${baseSha}:${path}`])).code === 0
    if (inBase) await must(run, ["checkout", baseSha, "--", path])
    else await must(run, ["rm", "-rf", "-q", "--ignore-unmatch", "--", path])
  }
  if ((await run(["diff", "--cached", "--quiet", baseSha, "--"])).code !== 0) {
    const [name = "reflection", email = "reflection@omo.local", subject = "reflection"] = identity
    // The agent's subject is copied forward, so it gets the same redaction as every other recorded text.
    const message = [`${redactSecretLikeMaterial(subject)} (kept valid entries)`, "", ...record.map(trailerLine)].join("\n")
    await must(run, [
      "-c", `user.name=${name}`, "-c", `user.email=${email}`,
      "commit", "-q", "--no-verify", "-m", message,
    ])
  }
  return (await must(run, ["rev-parse", "--verify", "HEAD"])).trim()
}
