import { readdir, readFile, realpath, stat } from "@oh-my-opencode/memory-core/fs"
import { join, relative } from "node:path"
import { Type, type Static } from "typebox"

import type { WakeToolBudget } from "./budget"
import type { KibitzerToolCaps } from "./caps"
import { resolveWorkspacePath } from "./path-safety"
import { boundedText, budgeted, okJson, rejection, type KibitzerSidecarTool } from "./result"

export const KIBITZER_GREP_TOOL_NAME = "grep"

export const KibitzerGrepParams = Type.Object({
  pattern: Type.String({ description: "JavaScript regular expression matched against each line." }),
  path: Type.Optional(Type.String({ description: "File or directory relative to the workspace root; defaults to the root." })),
  ignore_case: Type.Optional(Type.Boolean({ description: "Case-insensitive match." })),
}, { additionalProperties: false })

export interface KibitzerGrepToolInput {
  readonly workspaceRoot: string
  readonly caps: KibitzerToolCaps
  readonly budget: () => WakeToolBudget
}

export interface KibitzerGrepMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules"])
const MAX_FILE_BYTES = 1024 * 1024

/**
 * A member-scoped grep over the workspace: the walk never follows symlinks, skips VCS/dependency
 * trees and binary or oversize files, and stops at the match cap. senpi withholds its builtin grep
 * from children, and a builtin would bypass the budget and the redaction anyway.
 */
export function createKibitzerGrepTool(input: KibitzerGrepToolInput): KibitzerSidecarTool<typeof KibitzerGrepParams> {
  return {
    name: KIBITZER_GREP_TOOL_NAME,
    label: "Kibitzer grep",
    description: `Search workspace files by regular expression (at most ${input.caps.grepMatches} matching lines).`,
    parameters: KibitzerGrepParams,
    execute: budgeted(input.budget, async (params: Static<typeof KibitzerGrepParams>) => {
      let pattern: RegExp
      try {
        pattern = new RegExp(params.pattern, params.ignore_case === true ? "i" : "")
      } catch (error) {
        return rejection("invalid_pattern", error instanceof Error ? error.message : String(error))
      }
      const resolved = await resolveWorkspacePath(input.workspaceRoot, params.path ?? ".")
      if (!resolved.ok) return rejection(resolved.code, resolved.message, params.path)
      let info
      try {
        info = await stat(resolved.path)
      } catch {
        return rejection("not_found", `"${params.path ?? "."}" does not exist.`, params.path)
      }
      const root = await realpath(input.workspaceRoot)
      const matches: KibitzerGrepMatch[] = []
      const files = info.isFile() ? [resolved.path] : await walk(resolved.path)
      let truncated = false
      for (const file of files) {
        if (await grepFile(file, relative(root, file), pattern, matches, input.caps)) {
          truncated = true
          break
        }
      }
      return okJson({ matches, truncated })
    }),
  }
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop() as string
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(full)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

/** Returns true when the match cap was hit while scanning this file. */
async function grepFile(
  file: string,
  displayPath: string,
  pattern: RegExp,
  matches: KibitzerGrepMatch[],
  caps: KibitzerToolCaps,
): Promise<boolean> {
  const info = await stat(file)
  if (info.size > MAX_FILE_BYTES) return false
  const buffer = await readFile(file)
  if (buffer.subarray(0, 8192).includes(0)) return false
  const lines = buffer.toString("utf8").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (!pattern.test(line)) continue
    if (matches.length >= caps.grepMatches) return true
    matches.push({ path: displayPath.split("\\").join("/"), line: index + 1, text: boundedText(line, caps.grepLineChars) })
  }
  return false
}
