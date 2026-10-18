import type { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { redactSecretLikeMaterial } from "../sync/redact"
import {
  DEFAULT_EXTERNAL_PROJECTION_LIMITS,
  renderExternalProjection,
  renderExternalProjectionStats,
  type ExternalProjectionInput,
  type ExternalProjectionLimits,
  type ExternalProjectionStats,
} from "./external-projection"
import { renderSystemTree, type CompiledSystemFile } from "./render"

const PERSONA_PATH = "system/persona.md"
const IDENTITY_PATH = "system/identity.md"
const REMINDER =
  "Reminder: <projection> holds local paths of memory projections. <memory> is your persistent memory across conversations. Consult it BEFORE asking the user anything it may already answer. Save durable facts, preferences, decisions, and corrections with the memory tools THE MOMENT they emerge. Route facts about a person to their record under people/ (the primary human's card is system/human.md). Relevant stored memory arrives on its own as <recalled-memory> blocks; there is no recall tool to call."

export interface CompileMemoryBlockOptions {
  agentId: string
  /** Bounds `<external_projection>`; omitted means `DEFAULT_EXTERNAL_PROJECTION_LIMITS`. */
  projection?: ExternalProjectionLimits
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
  const identity = revision && paths.includes(IDENTITY_PATH)
    ? await readSystemFile(repo, revision, IDENTITY_PATH)
    : undefined
  const systemFiles = revision
    ? await readSystemFiles(repo, revision, paths.filter(isOtherSystemMarkdown))
    : []
  const externalPaths = paths.filter(isExternalPath)
  const external = await projectionInput(repo, revision, externalPaths, options.projection)
  const projection = renderProjection(persona, identity, systemFiles, externalPaths, external)
  const metadata = renderMetadata(options)
  return [projection, metadata].filter((part) => part.length > 0).join("\n\n")
}

/** What `<external_projection>` would show at `revision` under `limits`, without compiling the block. */
export async function externalProjectionStatsAt(
  repo: GitMemoryRepo,
  revision: string,
  limits: ExternalProjectionLimits = DEFAULT_EXTERNAL_PROJECTION_LIMITS,
): Promise<ExternalProjectionStats> {
  const externalPaths = (await repo.lsTree(revision)).filter(isExternalPath)
  return renderExternalProjectionStats(externalPaths, await projectionInput(repo, revision, externalPaths, limits))
}

async function projectionInput(
  repo: GitMemoryRepo,
  revision: string | null,
  externalPaths: readonly string[],
  limits: ExternalProjectionLimits = DEFAULT_EXTERNAL_PROJECTION_LIMITS,
): Promise<ExternalProjectionInput> {
  const bounded = limits.maxEntriesPerDirectory > 0 || limits.maxBytes > 0
  if (!bounded || !revision || externalPaths.length === 0) return { times: new Map(), limits }
  try {
    return { times: await repo.pathCommitTimes(revision), limits }
  } catch {
    // Commit times only order names; without them the same limits apply in name order, and the
    // fallback is reported (`/doctor` projection) instead of silently changing the order.
    return { times: new Map(), limits, recencyUnavailable: true }
  }
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
      body: redactSecretLikeMaterial(parsed.body),
      description: redactSecretLikeMaterial(parsed.frontmatter.description),
    }
  } catch {
    return undefined
  }
}

function renderProjection(
  persona: CompiledSystemFile | undefined,
  identity: CompiledSystemFile | undefined,
  systemFiles: readonly CompiledSystemFile[],
  externalPaths: readonly string[],
  external: ExternalProjectionInput,
): string {
  if (!persona && !identity && systemFiles.length === 0 && externalPaths.length === 0) return ""
  const lines = [REMINDER]
  if (persona || identity) {
    lines.push("", "<self>")
    if (persona) {
      lines.push(
        "<projection>$MEMORY_DIR/system/persona.md</projection>",
        persona.body.trimEnd(),
      )
    }
    if (identity) {
      lines.push(
        "<projection>$MEMORY_DIR/system/identity.md</projection>",
        identity.body.trimEnd(),
      )
    }
    lines.push("</self>")
  }
  if (systemFiles.length > 0 || externalPaths.length > 0) {
    lines.push("", "<memory>")
    if (systemFiles.length > 0) lines.push(renderSystemTree(systemFiles))
    if (externalPaths.length > 0) lines.push(renderExternalProjection(externalPaths, external))
    lines.push("</memory>")
  }
  return lines.join("\n")
}

function isOtherSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path !== PERSONA_PATH && path !== IDENTITY_PATH && path.endsWith(".md")
}

function isExternalPath(path: string): boolean {
  return !path.startsWith("system/") && !path.startsWith("skills/")
}

function renderMetadata(options: CompileMemoryBlockOptions): string {
  return [
    "<memory_metadata>",
    `- AGENT_ID: ${options.agentId}`,
    "</memory_metadata>",
  ].join("\n")
}
