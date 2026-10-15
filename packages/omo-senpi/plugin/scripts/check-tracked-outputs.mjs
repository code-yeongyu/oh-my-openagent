import { spawnSync } from "node:child_process"
import { isAbsolute, relative, sep } from "node:path"

/** Check the index as well as ignore policy: a forced git add must not hide an ignored output. */
export function checkTrackedOutputs(repoRoot, outputs) {
  if (outputs.length === 0) return undefined
  const paths = outputs.map((output) => {
    const path = relative(repoRoot, output)
    if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`Generated output is outside the repository: ${output}`)
    }
    return path.split(sep).join("/")
  })
  const ignored = new Set(gitPaths(repoRoot, ["check-ignore", "--no-index", "-z", "--stdin"], `${paths.join("\0")}\0`, [0, 1]))
  const tracked = new Set(gitPaths(repoRoot, ["--literal-pathspecs", "ls-files", "--cached", "-z", "--", ...paths]))
  for (const [index, path] of paths.entries()) {
    if (ignored.has(path)) return { ok: false, reason: "ignored-output", output: outputs[index] }
    if (!tracked.has(path)) return { ok: false, reason: "untracked-output", output: outputs[index] }
  }
  return undefined
}

function gitPaths(repoRoot, args, input, acceptedStatuses = [0]) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error !== undefined || result.signal !== null || !acceptedStatuses.includes(result.status)) {
    throw new Error(`Cannot verify generated outputs: git ${args[0]} failed (status=${result.status}, signal=${result.signal})`, { cause: result.error })
  }
  return result.stdout.split("\0").filter(Boolean)
}
