import { GIT_TIMEOUT_MS } from "../constants"
import type { PanelRow } from "../types"
import type { PanelGitEntry } from "./parse"
import type { PanelExec } from "./read"

/** Extended headers git prints above a hunk; they are structure, not content. */
const HEADER_PREFIXES = [
  "diff ",
  "index ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "dissimilarity index",
  "rename from",
  "rename to",
  "copy from",
  "copy to",
  "Binary files",
]

/**
 * The diff git itself would print, coloured by line kind.
 *
 * A rename needs BOTH paths in the pathspec: given only the destination, git sees an
 * unrelated new file and prints the whole content as additions. An untracked file has no
 * index side at all, so it is diffed against /dev/null, which exits 1 by design.
 */
export function gitDiffArgs(file: PanelGitEntry): string[] {
  if (file.xy === "??") return ["--literal-pathspecs", "diff", "--no-index", "--", "/dev/null", file.path]
  const paths = file.from === undefined ? [file.path] : [file.from, file.path]
  return ["--literal-pathspecs", "diff", "HEAD", "-M", "--", ...paths]
}

/** Files of one untracked directory the viewer diffs; the rest are counted in a closing row. */
export const UNTRACKED_DIRECTORY_FILE_CAP = 50

export async function readGitDiff(exec: PanelExec, root: string, file: PanelGitEntry): Promise<readonly PanelRow[]> {
  if (file.xy === "??" && file.path.endsWith("/")) {
    const listed = await exec(
      "git",
      ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", file.path],
      { cwd: root, timeout: GIT_TIMEOUT_MS },
    ).catch(() => undefined)
    if (listed === undefined || listed.code !== 0) return [{ text: "git diff could not be run", color: "error" }]
    const listedPaths = listed.stdout.split("\0").filter((path) => path !== "")
    // One process per file: an untracked build directory must not become thousands of spawns.
    const paths = listedPaths.slice(0, UNTRACKED_DIRECTORY_FILE_CAP)
    const results = await Promise.all(
      paths.map((path) =>
        exec("git", gitDiffArgs({ xy: "??", path }), { cwd: root, timeout: GIT_TIMEOUT_MS }).catch(() => undefined),
      ),
    )
    if (results.some((result) => result === undefined)) return [{ text: "git diff could not be run", color: "error" }]
    const rows = results.flatMap((result) => colorizeDiff(result?.stdout ?? ""))
    const omitted = listedPaths.length - paths.length
    if (omitted > 0) rows.push({ text: `... ${omitted} more files in ${file.path}`, color: "muted" })
    return rows.length > 0 ? rows : [{ text: "no textual change", color: "muted" }]
  }
  let result = await exec("git", gitDiffArgs(file), { cwd: root, timeout: GIT_TIMEOUT_MS }).catch(() => undefined)
  if (result?.code === 128 && result.stdout === "" && file.xy[0] !== " ") {
    result = await exec(
      "git",
      ["--literal-pathspecs", "diff", "--no-index", "--", "/dev/null", file.path],
      { cwd: root, timeout: GIT_TIMEOUT_MS },
    ).catch(() => undefined)
  }
  if (result === undefined) return [{ text: "git diff could not be run", color: "error" }]
  // `--no-index` exits 1 whenever the files differ, which is the normal case here.
  if (result.stdout === "" && result.code !== 0 && result.code !== 1) {
    return [{ text: `git diff failed (exit ${result.code})`, color: "error" }]
  }
  const rows = colorizeDiff(result.stdout)
  return rows.length > 0 ? rows : [{ text: "no textual change", color: "muted" }]
}

/** Pure: turn diff text into coloured rows. */
export function colorizeDiff(output: string): readonly PanelRow[] {
  const rows: PanelRow[] = []
  for (const line of output.split("\n")) {
    if (line === "") continue
    rows.push({ text: line, color: colorFor(line) })
  }
  return rows
}

function colorFor(line: string): PanelRow["color"] {
  if (line.startsWith("+++") || line.startsWith("---")) return "muted"
  if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) return "muted"
  if (line.startsWith("@@")) return "accent"
  if (line.startsWith("+")) return "success"
  if (line.startsWith("-")) return "error"
  return "text"
}
