import { execFile } from "node:child_process"

import { defineTool, type ToolDefinition } from "@code-yeongyu/senpi"
import { Type, type Static } from "typebox"

const CurlProgram = Type.Literal("curl")
const GitHubProgram = Type.Literal("gh")

export const CuratedReadonlyBashParams = Type.Object({
  program: Type.Union([CurlProgram, GitHubProgram], {
    description: "Read-only client to invoke directly. No shell is used.",
  }),
  args: Type.Array(Type.String(), {
    description: "Argument vector. Shell syntax, writes, uploads, and mutation-capable flags are rejected.",
    minItems: 1,
    maxItems: 64,
  }),
  timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
})

export type CuratedReadonlyBashInput = Static<typeof CuratedReadonlyBashParams>

export type CuratedReadonlyRequest = {
  readonly program: "curl" | "gh"
  readonly args: readonly string[]
}

export type CuratedReadonlyCommand = {
  readonly program: "curl" | "gh"
  readonly args: readonly string[]
}

const CURL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "-f", "--fail", "--fail-with-body", "-I", "--head", "-L", "--location",
  "--compressed", "--no-progress-meter", "-s", "--silent", "-S", "--show-error",
])
const CURL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--connect-timeout", "--max-time", "--retry", "--retry-delay", "-A", "--user-agent",
])
const GH_SEARCH_KINDS: ReadonlySet<string> = new Set(["code", "commits", "issues", "prs", "repos"])
const GH_SEARCH_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--archived", "--include-forks"])
const GH_SEARCH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--extension", "--filename", "--language", "--limit", "--match", "--order", "--owner",
  "--repo", "--sort", "--state", "--updated", "--visibility", "--json", "--jq", "--template",
])
const GH_VIEW_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--comments"])
const GH_VIEW_VALUE_FLAGS: ReadonlySet<string> = new Set(["--json", "--jq", "--repo", "--template"])
const GH_API_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--include", "--paginate", "--slurp"])
const GH_API_VALUE_FLAGS: ReadonlySet<string> = new Set(["--hostname", "--jq", "--template"])

export class CuratedReadonlyCommandError extends Error {
  readonly name = "CuratedReadonlyCommandError"
}

export function planCuratedReadonlyCommand(request: CuratedReadonlyRequest): CuratedReadonlyCommand {
  const args = [...request.args]
  if (request.program === "curl" && isReadonlyCurl(args)) {
    return { program: "curl", args: args[0] === "--version" ? args : ["--disable", ...args] }
  }
  if (request.program === "gh" && isReadonlyGitHub(args)) return { program: "gh", args }
  throw new CuratedReadonlyCommandError("The curated bash tool accepts read-only GitHub and HTTPS retrieval operations only.")
}

export function createCuratedReadonlyBashTool(
  cwd: string,
): ToolDefinition {
  return defineTool({
    name: "bash",
    label: "Read-only research",
    description: "Run a structured read-only gh or curl request directly, without a shell or filesystem-writing flags.",
    promptSnippet: "Structured read-only remote research through gh or curl; arbitrary shell commands are unavailable.",
    parameters: CuratedReadonlyBashParams,
    execute: async (_toolCallId, input, signal) => {
      const command = planCuratedReadonlyCommand(input)
      const text = await executeCommand(command, cwd, input.timeout_seconds ?? 30, signal)
      return { content: [{ type: "text", text }], details: undefined }
    },
  })
}

function isReadonlyCurl(args: readonly string[]): boolean {
  if (args.length === 1 && args[0] === "--version") return true
  let urls = 0
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (arg.startsWith("https://")) {
      urls += 1
      continue
    }
    if (CURL_BOOLEAN_FLAGS.has(arg)) continue
    if (!CURL_VALUE_FLAGS.has(arg) || args[index + 1] === undefined) return false
    index += 1
  }
  return urls === 1
}

function isReadonlyGitHub(args: readonly string[]): boolean {
  if (args.length === 1 && args[0] === "--version") return true
  const [command, subcommand, ...rest] = args
  if (command === "search" && subcommand !== undefined && GH_SEARCH_KINDS.has(subcommand)) {
    return flagsAndPositionalsAreSafe(rest, GH_SEARCH_BOOLEAN_FLAGS, GH_SEARCH_VALUE_FLAGS, 1)
  }
  if (command === "repo" && subcommand === "view") {
    return flagsAndPositionalsAreSafe(rest, new Set(), GH_VIEW_VALUE_FLAGS, 1)
  }
  if ((command === "issue" || command === "pr") && subcommand === "view") {
    return flagsAndPositionalsAreSafe(rest, GH_VIEW_BOOLEAN_FLAGS, GH_VIEW_VALUE_FLAGS, 1)
  }
  if (command === "release" && (subcommand === "view" || subcommand === "list")) {
    return flagsAndPositionalsAreSafe(rest, new Set(), GH_VIEW_VALUE_FLAGS, 1)
  }
  if (command !== "api" || subcommand === undefined || subcommand === "graphql" || subcommand.startsWith("-")) return false
  return flagsAndPositionalsAreSafe(rest, GH_API_BOOLEAN_FLAGS, GH_API_VALUE_FLAGS, 0)
}

function flagsAndPositionalsAreSafe(
  args: readonly string[],
  booleanFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
  maxPositionals: number,
): boolean {
  let positionals = 0
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (!arg.startsWith("-")) {
      positionals += 1
      if (positionals > maxPositionals) return false
      continue
    }
    if (booleanFlags.has(arg)) continue
    if (!valueFlags.has(arg) || args[index + 1] === undefined) return false
    index += 1
  }
  return true
}

function executeCommand(
  command: CuratedReadonlyCommand,
  cwd: string,
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command.program, command.args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024,
      timeout: timeoutSeconds * 1_000,
      signal,
      windowsHide: true,
      env: { ...process.env, GH_PAGER: "cat", GH_PROMPT_DISABLED: "1", GIT_PAGER: "cat", PAGER: "cat" },
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new CuratedReadonlyCommandError(
          `Read-only ${command.program} request failed: ${stderr.trim() || error.message}`,
          { cause: error },
        ))
        return
      }
      resolve([stdout.trim(), stderr.trim()].filter((part) => part.length > 0).join("\n") || "(no output)")
    })
  })
}
