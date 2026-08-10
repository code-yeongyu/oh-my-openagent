import type { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import {
  renderExternalProjection,
  renderSystemTree,
  type CompiledSystemFile,
} from "./render"

const PERSONA_PATH = "system/persona.md"
const REMINDER =
  "Reminder: <projection> contains the local path of the memory file projection. <memory> is your persistent memory across conversations: consult it before asking the user anything it may already answer, and save durable facts, preferences, decisions, and corrections with the memory tools as soon as they emerge instead of waiting to be asked."

export interface CompileMemoryBlockOptions {
  agentId: string
  conversationId: string
  previousMessageCount: number
  clock?: () => Date
}

export async function compileMemoryBlock(
  repo: GitMemoryRepo,
  options: CompileMemoryBlockOptions,
): Promise<string> {
  return compileMemoryBlockAtRevision(repo, await repo.head(), options)
}

export async function compileMemoryBlockAtRevision(
  repo: GitMemoryRepo,
  revision: string | null,
  options: CompileMemoryBlockOptions,
): Promise<string> {
  const paths = revision ? await repo.lsTree(revision) : []
  const persona = revision && paths.includes(PERSONA_PATH)
    ? await readSystemFile(repo, revision, PERSONA_PATH)
    : undefined
  const systemFiles = revision
    ? await readSystemFiles(repo, revision, paths.filter(isOtherSystemMarkdown))
    : []
  const externalPaths = paths.filter(isExternalPath)
  const projection = renderProjection(persona, systemFiles, externalPaths)
  const metadata = renderMetadata(options, (options.clock ?? (() => new Date()))())
  return [projection, metadata].filter((part) => part.length > 0).join("\n\n")
}

async function readSystemFiles(
  repo: GitMemoryRepo,
  revision: string,
  paths: readonly string[],
): Promise<CompiledSystemFile[]> {
  const files = await Promise.all(paths.map((path) => readSystemFile(repo, revision, path)))
  return files.filter((file): file is CompiledSystemFile => file !== undefined)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function readSystemFile(
  repo: GitMemoryRepo,
  revision: string,
  relativePath: string,
): Promise<CompiledSystemFile | undefined> {
  try {
    const parsed = parseMemoryFile(await repo.show(revision, relativePath))
    return {
      relativePath,
      body: parsed.body,
      description: parsed.frontmatter.description,
    }
  } catch {
    return undefined
  }
}

function renderProjection(
  persona: CompiledSystemFile | undefined,
  systemFiles: readonly CompiledSystemFile[],
  externalPaths: readonly string[],
): string {
  if (!persona && systemFiles.length === 0 && externalPaths.length === 0) return ""
  const lines = [REMINDER]
  if (persona) {
    lines.push(
      "",
      "<self>",
      "<projection>$MEMORY_DIR/system/persona.md</projection>",
      persona.body.trimEnd(),
      "</self>",
    )
  }
  if (systemFiles.length > 0 || externalPaths.length > 0) {
    lines.push("", "<memory>")
    if (systemFiles.length > 0) lines.push(renderSystemTree(systemFiles))
    if (externalPaths.length > 0) lines.push(renderExternalProjection(externalPaths))
    lines.push("</memory>")
  }
  return lines.join("\n")
}

function isOtherSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path !== PERSONA_PATH && path.endsWith(".md")
}

function isExternalPath(path: string): boolean {
  return !path.startsWith("system/") && !path.startsWith("skills/")
}

function renderMetadata(options: CompileMemoryBlockOptions, compiledAt: Date): string {
  return [
    "<memory_metadata>",
    `- AGENT_ID: ${options.agentId}`,
    `- CONVERSATION_ID: ${options.conversationId}`,
    `- System prompt last recompiled: ${formatUtcTimestamp(compiledAt)}`,
    `- ${options.previousMessageCount} previous messages between you and the user are stored in recall memory`,
    "</memory_metadata>",
  ].join("\n")
}

function formatUtcTimestamp(date: Date): string {
  const hour = date.getUTCHours()
  const hour12 = hour % 12 || 12
  const meridiem = hour < 12 ? "AM" : "PM"
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(hour12)}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} ${meridiem} UTC+0000`
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0")
}
