import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runGit } from "./command"

export async function writeSyntheticTree(objectRepoDir: string, headCommit: string, patches: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isolation-index-"))
  const options = { cwd: objectRepoDir, env: { GIT_INDEX_FILE: join(dir, "index") } }
  try {
    await runGit(["read-tree", headCommit || "--empty"], options)
    for (const patch of patches) {
      if (patch.trim()) await runGit(["apply", "--cached", "--binary", "--whitespace=nowarn", "-"], { ...options, input: patch })
    }
    return (await runGit(["write-tree"], options)).stdout.toString().trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Git quotes UTF-8 bytes with C escapes (including octal), not JSON escapes. */
export function unquoteGitDiffPath(rawPath: string): string {
  let value = rawPath
  if (value.startsWith('"') && value.endsWith('"')) {
    const body = value.slice(1, -1)
    const bytes: number[] = []
    const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 }
    for (let i = 0; i < body.length;) {
      if (body[i] === "\\") {
        const octal = body.slice(i + 1).match(/^[0-7]{1,3}/)?.[0]
        if (octal) { bytes.push(parseInt(octal, 8)); i += octal.length + 1 }
        else { bytes.push(escapes[body[i + 1]!] ?? body.charCodeAt(i + 1)); i += 2 }
      } else {
        const char = String.fromCodePoint(body.codePointAt(i)!)
        bytes.push(...Buffer.from(char)); i += char.length
      }
    }
    value = Buffer.from(bytes).toString()
  }
  return value.replace(/^[ab]\//, "")
}

export function parseDiffGitLinePaths(line: string): string[] {
  if (!line.startsWith("diff --git ")) return []
  const rest = line.slice(11)
  const quoted = '"(?:\\\\.|[^"\\\\])*"'
  const match = rest.match(new RegExp(`^(${quoted}|a/.*?) (${quoted}|b/.*)$`))
  if (!match) return []
  return [...new Set([match[1]!, match[2]!].map(unquoteGitDiffPath).filter(path => path && path !== "/dev/null"))]
}
