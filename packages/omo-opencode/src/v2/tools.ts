import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] v2 tools & hooks port (task 10).
 *
 * Ports a meaningful subset of the OMC V1 tool + hook surface to the
 * @opencode/plugin@2.0.20 domain API:
 *
 *   - Tools  (V1 `tool({...})` helper from the legacy plugin/tool subpath) →
 *     `ctx.tool.transform(editor => editor.add(info))`.
 *   - Tool hooks (V1 `tool.execute.before` / `tool.execute.after`) →
 *     `ctx.tool.hook("execute.before" | "execute.after")`.
 *   - Session hook (V1 `experimental.session.compacting`, G5) →
 *     `ctx.session.hook("compaction")`.
 *   - Shell hook (V1 `command.execute.before`, G4) →
 *     `ctx.shell.hook("create.before")`.
 *
 * The two tools ported here (`glob`, `grep`) are the OMC "core utility"
 * tools used on the main agent path; their execute logic is a self-contained
 * native reimplementation (no ripgrep external binary) so they run
 * deterministically inside the isolated V2 harness. Full parity of the
 * remaining tool surface (call-omo-agent, task, background-*, monitor, …)
 * is a later wave — see docs/v2-api-mapping.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

// ---------------------------------------------------------------------------
// Input schemas (zod, shared by the tool `input` field and the RPC invoke path)
// ---------------------------------------------------------------------------

const globInputSchema = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      "The directory to search in. If not specified, the current working directory will be used. " +
        "IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - " +
        "simply omit it for the default behavior. Must be a valid directory path if provided.",
    ),
})

type GlobInput = z.infer<typeof globInputSchema>

const grepInputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  include: z
    .string()
    .optional()
    .describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  path: z
    .string()
    .optional()
    .describe("The directory to search in. Defaults to the current working directory."),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe(
      'Output mode: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts per file.',
    ),
  head_limit: z
    .number()
    .optional()
    .describe("Limit output to first N entries. 0 or omitted means no limit."),
})

type GrepInput = z.infer<typeof grepInputSchema>

// ---------------------------------------------------------------------------
// Safety limits (mirrors the OMC V1 contract, tightened for the native walk)
// ---------------------------------------------------------------------------

const GLOB_MAX_RESULTS = 100
const GLOB_MAX_SCANNED_FILES = 20000

const GREP_MAX_OUTPUT_BYTES = 256 * 1024
const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024
const GREP_MAX_SCANNED_FILES = 20000
const GREP_MAX_MATCHES = 10000

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "__pycache__",
])

// ---------------------------------------------------------------------------
// Glob matching (supports `**`, `*`, `?`, `[class]`, `{a,b}`)
// ---------------------------------------------------------------------------

function escapeRegExpChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char
}

function escapeRegExp(literal: string): string {
  return literal.split("").map(escapeRegExpChar).join("")
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/")
  let regex = "^"
  let i = 0
  while (i < normalized.length) {
    const char = normalized[i]
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regex += "(?:.*/)?"
          i += 3
        } else {
          regex += ".*"
          i += 2
        }
      } else {
        regex += "[^/]*"
        i += 1
      }
    } else if (char === "?") {
      regex += "[^/]"
      i += 1
    } else if (char === "[") {
      const close = normalized.indexOf("]", i)
      if (close === -1) {
        regex += "\\["
        i += 1
      } else {
        regex += normalized.slice(i, close + 1)
        i = close + 1
      }
    } else if (char === "{") {
      const close = normalized.indexOf("}", i)
      if (close === -1) {
        regex += "\\{"
        i += 1
      } else {
        const inner = normalized.slice(i + 1, close)
        regex += `(?:${inner.split(",").map(escapeRegExp).join("|")})`
        i = close + 1
      }
    } else {
      regex += escapeRegExpChar(char)
      i += 1
    }
  }
  regex += "$"
  return new RegExp(regex)
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/")
}

// ---------------------------------------------------------------------------
// File walker (depth-first, bounded, skips build/dependency dirs)
// ---------------------------------------------------------------------------

interface WalkedFile {
  readonly absolute: string
  readonly relative: string
  readonly mtime: number
}

function walkFiles(root: string): WalkedFile[] {
  const files: WalkedFile[] = []
  const stack: string[] = [root]
  let visitedDirs = 0

  while (stack.length > 0 && files.length < GLOB_MAX_SCANNED_FILES && visitedDirs < GLOB_MAX_SCANNED_FILES) {
    const dir = stack.pop()
    if (dir === undefined) break
    visitedDirs += 1

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= GLOB_MAX_SCANNED_FILES) break
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        stack.push(absolute)
      } else if (entry.isFile()) {
        let mtime = 0
        try {
          mtime = statSync(absolute).mtime.getTime()
        } catch {
          // unreadable file — keep mtime 0
        }
        files.push({
          absolute,
          relative: toPosixPath(relative(root, absolute)),
          mtime,
        })
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Core tool logic
// ---------------------------------------------------------------------------

async function runGlob(input: GlobInput, directory: string): Promise<string> {
  const searchPath = input.path ? resolve(directory, input.path) : directory
  const matcher = globToRegExp(input.pattern)

  const files = walkFiles(searchPath)
    .filter((file) => matcher.test(file.relative) || matcher.test(toPosixPath(file.absolute)))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, GLOB_MAX_RESULTS)

  if (files.length === 0) return "No files found"

  const lines: string[] = [`Found ${files.length} file(s)`, ""]
  for (const file of files) {
    lines.push(file.absolute)
  }
  return lines.join("\n")
}

interface GrepMatch {
  readonly file: string
  readonly line: number
  readonly text: string
}

async function runGrep(input: GrepInput, directory: string): Promise<string> {
  const searchPath = input.path ? resolve(directory, input.path) : directory
  const outputMode = input.output_mode ?? "files_with_matches"
  const headLimit = input.head_limit && input.head_limit > 0 ? input.head_limit : undefined

  let regex: RegExp
  try {
    regex = new RegExp(input.pattern)
  } catch (error) {
    return `Error: invalid regex: ${error instanceof Error ? error.message : String(error)}`
  }

  const includeMatcher = input.include ? globToRegExp(input.include) : undefined

  const matches: GrepMatch[] = []
  const perFileCount = new Map<string, number>()
  let scannedFiles = 0
  let outputBytes = 0
  let truncated = false

  for (const file of walkFiles(searchPath)) {
    if (scannedFiles >= GREP_MAX_SCANNED_FILES) break
    if (includeMatcher && !includeMatcher.test(file.relative) && !includeMatcher.test(toPosixPath(file.absolute))) {
      continue
    }
    scannedFiles += 1

    let content: string
    try {
      const stat = statSync(file.absolute)
      if (stat.size > GREP_MAX_FILE_BYTES) continue
      content = readFileSync(file.absolute, "utf8")
    } catch {
      continue
    }

    const lines = content.split(/\r?\n/)
    let fileCount = 0
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index]
      if (regex.test(lineText)) {
        fileCount += 1
        if (outputMode !== "count") {
          matches.push({ file: file.absolute, line: index + 1, text: lineText })
        }
      }
    }

    if (fileCount > 0) {
      perFileCount.set(file.absolute, fileCount)
    }
  }

  if (outputMode === "count") {
    const entries = [...perFileCount.entries()].sort((a, b) => b[1] - a[1])
    const limited = headLimit ? entries.slice(0, headLimit) : entries
    if (limited.length === 0) return "No matches found"
    const total = limited.reduce((sum, [, count]) => sum + count, 0)
    const out = [`Found ${total} match(es) in ${limited.length} file(s):`, ""]
    for (const [file, count] of limited) {
      out.push(`  ${String(count).padStart(6)}: ${file}`)
    }
    return out.join("\n")
  }

  const limited = headLimit ? matches.slice(0, headLimit) : matches.slice(0, GREP_MAX_MATCHES)
  if (matches.length > limited.length) truncated = true

  if (limited.length === 0) return "No matches found"

  const isFilesOnlyMode = outputMode === "files_with_matches"
  const byFile = new Map<string, GrepMatch[]>()
  for (const match of limited) {
    const existing = byFile.get(match.file) ?? []
    existing.push(match)
    byFile.set(match.file, existing)
  }

  const header = `Found ${limited.length} match(es) in ${byFile.size} file(s)`
  const chunks: string[] = [header]
  if (truncated) chunks.push("[Output truncated due to size limit]")
  chunks.push("")

  for (const [file, fileMatches] of byFile) {
    const line = file
    if (outputBytes + line.length > GREP_MAX_OUTPUT_BYTES) {
      truncated = true
      break
    }
    outputBytes += line.length
    chunks.push(line)
    if (!isFilesOnlyMode) {
      for (const match of fileMatches) {
        const trimmed = match.text.trim()
        if (match.line === 0 && trimmed === "") continue
        const entry = `  ${match.line}: ${trimmed}`
        if (outputBytes + entry.length > GREP_MAX_OUTPUT_BYTES) {
          truncated = true
          break
        }
        outputBytes += entry.length
        chunks.push(entry)
      }
    }
    chunks.push("")
  }

  if (truncated) chunks.push("[Output truncated due to size limit]")
  return chunks.join("\n")
}

// ---------------------------------------------------------------------------
// Hook activity buffer (readable via the `omo.tools` diagnostic RPC for
// runtime evidence that hooks are wired and firing).
// ---------------------------------------------------------------------------

interface HookActivity {
  readonly at: string
  readonly kind: string
  readonly detail: string
}

const hookActivity: HookActivity[] = []

function recordActivity(kind: string, detail: string): void {
  hookActivity.push({ at: new Date().toISOString(), kind, detail })
  if (hookActivity.length > 100) hookActivity.shift()
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerToolsAndHooks(ctx: PluginContext): Promise<() => Promise<void>> {
  const directory = ctx.location.directory

  const runners: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    glob: (input) => {
      const parsed = globInputSchema.safeParse(input)
      if (!parsed.success) {
        return Promise.reject(new Error(`invalid glob input: ${parsed.error.message}`))
      }
      return runGlob(parsed.data, directory)
    },
    grep: (input) => {
      const parsed = grepInputSchema.safeParse(input)
      if (!parsed.success) {
        return Promise.reject(new Error(`invalid grep input: ${parsed.error.message}`))
      }
      return runGrep(parsed.data, directory)
    },
  }

  // 1. Tool registration (V1 `tool` registry → V2 `ctx.tool.transform`).
  await ctx.tool.transform((editor) => {
    editor.add({
      name: "glob",
      description:
        "Fast file pattern matching tool with safety limits (60s timeout, 100 file limit). " +
        'Supports glob patterns like "**/*.js" or "src/**/*.ts". ' +
        "Returns matching file paths sorted by modification time. " +
        "Use this tool when you need to find files by name patterns.",
      input: globInputSchema,
      execute: async (input: GlobInput) => ({ content: await runGlob(input, directory) }),
    })

    editor.add({
      name: "grep",
      description:
        "Fast content search tool with safety limits (60s timeout, 256KB output). " +
        "Searches file contents using regular expressions. " +
        'Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.). ' +
        'Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}"). ' +
        'Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts per file.',
      input: grepInputSchema,
      execute: async (input: GrepInput) => ({ content: await runGrep(input, directory) }),
    })
  })

  // 2. Tool hooks (V1 `tool.execute.before` / `tool.execute.after`).
  await ctx.tool.hook("execute.before", (input) => {
    recordActivity("tool.execute.before", input.tool)
    // Strip the mcp_ prefix the model sometimes emits (V1 parity: fixes #2697).
    if (input.tool.toLowerCase().startsWith("mcp_")) {
      input.tool = input.tool.replace(/^mcp_/i, "")
    }
  })

  await ctx.tool.hook("execute.after", (input) => {
    recordActivity("tool.execute.after", `${input.tool}:${input.status}`)
  })

  // 3. Session hook (V1 `experimental.session.compacting` → V2 `session.compaction`, G5).
  await ctx.session.hook("compaction", (input) => {
    recordActivity("session.compaction", input.sessionID)
  })

  // 4. Shell hook (V1 `command.execute.before` → V2 `shell.create.before`, G4).
  await ctx.shell.hook("create.before", (input) => {
    recordActivity("shell.create.before", input.command)
    // Strip null bytes from commands (V1 parity).
    if (input.command.includes("\x00")) {
      input.command = input.command.replace(/\x00/g, "")
    }
  })

  // 5. Diagnostic RPC (id "omo.tools", distinct from the task-9 "omo" RPC).
  const rpc = await ctx.rpc.register(
    {
      id: "omo.tools",
      methods: {
        list: {
          input: z.object({}),
          output: z.object({ tools: z.array(z.string()) }),
        },
        invoke: {
          input: z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()) }),
          output: z.object({
            ok: z.boolean(),
            content: z.string().optional(),
            error: z.string().optional(),
          }),
        },
        hooks: {
          input: z.object({}),
          output: z.object({ activity: z.array(z.object({ at: z.string(), kind: z.string(), detail: z.string() })) }),
        },
      },
      events: {},
    },
    {
      list: async () => {
        const registered = await ctx.tool.list()
        return { tools: registered.map((tool) => tool.id) }
      },
      invoke: async (input) => {
        const runner = runners[input.tool]
        if (!runner) {
          return { ok: false, error: `unknown tool: ${input.tool} (available: ${Object.keys(runners).join(", ")})` }
        }
        try {
          const content = await runner(input.input)
          return { ok: true, content }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      hooks: async () => ({ activity: hookActivity.slice() }),
    },
  )

  return async () => {
    await rpc.dispose()
  }
}
