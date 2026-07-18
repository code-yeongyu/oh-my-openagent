import { homedir } from "node:os"

import { resolveCodegraphWorkspacePaths } from "./workspace"

const CODEGRAPH_UNINITIALIZED_PATTERN =
  /CodeGraph not initialized in ([\s\S]*?)\.\s*Run ["'`]codegraph init["'`] in that project first\./i
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const CODEGRAPH_STATUS_PROJECT_PATTERN = /^.*?\bProject:\s*(.+?)\s*$/im
const CODEGRAPH_STATUS_UNINITIALIZED_PATTERN =
  /^.*?\bNot initialized\s*$/im
const CODEGRAPH_INIT_HINT_PATTERN =
  /Run\s+["'`]codegraph init["'`]\s+(?:in that project first|to initialize)\.?/i

export interface CodegraphInitGuidanceInput {
  readonly cwd?: unknown
  readonly toolName?: unknown
  readonly toolOutput: unknown
}

export interface CodegraphInitGuidanceOptions {
  readonly homeDir?: string
}

export function getCodegraphUninitializedProject(input: CodegraphInitGuidanceInput): string | null {
  const output = textFromUnknown(input.toolOutput)
  if (!isCodegraphTool(input.toolName)) return null

  const projectPath = extractProjectPath(output)
  if (projectPath !== null) return projectPath
  if (!looksLikeCodegraphUninitializedOutput(output)) return null
  return typeof input.cwd === "string" && input.cwd.trim().length > 0 ? input.cwd.trim() : null
}

export function buildCodegraphInitGuidance(
  projectPath: string,
  options: CodegraphInitGuidanceOptions = {},
): string {
  const { dataDir, dataRoot, projectLink } = resolveCodegraphWorkspacePaths(projectPath, {
    homeDir: options.homeDir ?? homedir(),
  })
  const displayProjectPath = formatDisplayPath(projectPath)
  const displayProjectLink = formatDisplayPath(projectLink)
  const displayDataDir = formatDisplayPath(dataDir)
  const displayDataRoot = formatDisplayPath(dataRoot)
  return [
    "OMO CodeGraph initialization guidance:",
    "",
    `CodeGraph is not initialized for ${displayProjectPath}. Initialize it through OMO's global local store instead of leaving a standalone project-local index.`,
    "",
    `- Link or create ${displayProjectLink} so it points at ${displayDataDir} under the OMO store ${displayDataRoot}.`,
    `- Then run \`codegraph init\` from ${displayProjectPath} and retry the CodeGraph tool.`,
    "- OMO's CodeGraph bootstrap does this automatically on session start; if bootstrap just ran, wait for it to finish and retry.",
  ].join("\n")
}

export function buildCodegraphInitGuidanceForToolResult(
  input: CodegraphInitGuidanceInput,
  options: CodegraphInitGuidanceOptions = {},
): string | null {
  const projectPath = getCodegraphUninitializedProject(input)
  return projectPath === null ? null : buildCodegraphInitGuidance(projectPath, options)
}

function extractProjectPath(output: string): string | null {
  const normalizedOutput = normalizeCodegraphOutput(output)
  const uninitializedMatch = normalizedOutput.match(CODEGRAPH_UNINITIALIZED_PATTERN)
  const uninitializedProject = uninitializedMatch?.[1]?.trim()
  if (uninitializedProject && uninitializedProject.length > 0) return uninitializedProject

  if (!looksLikeCodegraphUninitializedOutput(normalizedOutput)) return null
  const statusMatch = normalizedOutput.match(CODEGRAPH_STATUS_PROJECT_PATTERN)
  const statusProject = statusMatch?.[1]?.trim()
  return statusProject && statusProject.length > 0 ? statusProject : null
}

function looksLikeCodegraphUninitializedOutput(output: string): boolean {
  const normalizedOutput = normalizeCodegraphOutput(output)
  if (normalizedOutput.match(CODEGRAPH_UNINITIALIZED_PATTERN) !== null) return true
  return CODEGRAPH_STATUS_UNINITIALIZED_PATTERN.test(normalizedOutput) && CODEGRAPH_INIT_HINT_PATTERN.test(normalizedOutput)
}

function normalizeCodegraphOutput(output: string): string {
  return output.replace(ANSI_ESCAPE_PATTERN, "")
}

function isCodegraphTool(toolName: unknown): boolean {
  if (typeof toolName !== "string") return false
  return toolName.startsWith("codegraph.")
    || toolName.startsWith("codegraph_")
    || toolName.startsWith("mcp__codegraph__")
}

function formatDisplayPath(value: string): string {
  return JSON.stringify(value)
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n")
  if (!isRecord(value)) return ""

  return Object.entries(value)
    .map(([key, nested]) => `${key}: ${textFromUnknown(nested)}`)
    .filter((line) => line.trim().length > 0)
    .join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
