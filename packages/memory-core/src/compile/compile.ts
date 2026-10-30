import { AGREEMENTS_PATH } from "../agreements/types"
import { renderAgreementsSection } from "../agreements/render"
import type { GitMemoryRepo } from "../git"
import { isMemoryExpired, memoryExpiresAtMs } from "../memfs/expiry"
import { parseMemoryFile } from "../memfs/frontmatter"
import { MEMORY_AUTHORITY_RULE } from "../provenance"
import { redactSecretLikeMaterial } from "../sync/redact"
import type { ExternalProjectionInput, ExternalProjectionStats } from "./external-projection"
import { DEFAULT_EXTERNAL_PROJECTION_LIMITS, type ExternalProjectionLimits } from "./external-projection-limits"
import { renderSystemTree, type CompiledSystemFile } from "./render"

const PERSONA_PATH = "system/persona.md"
const IDENTITY_PATH = "system/identity.md"
const REMINDER =
  "Reminder: <projection> holds local paths of memory projections. <memory> is your persistent memory across conversations. Consult it BEFORE asking the user anything it may already answer. Save durable facts, preferences, decisions, and corrections with the memory tools THE MOMENT they emerge. Route facts about a person to their record under people/ (the primary human's card is system/human.md). Relevant stored memory arrives on its own as <recalled-memory> blocks; there is no recall tool to call. "
  + MEMORY_AUTHORITY_RULE

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

/**
 * `asOfMs` is the instant `expires` is evaluated at (default: now). A session pinned to a revision passes its pin
 * instant so the bytes it injects never change when a file expires mid-session.
 */
export async function compileMemoryBlockAtRevision(
  repo: GitMemoryRepo,
  revision: string | null,
  options: CompileMemoryBlockOptions,
  asOfMs: number = Date.now(),
): Promise<string> {
  return (await compileMemoryBlockWithReads(repo, revision, options, asOfMs)).block
}

/** A projected-or-skipped system file that declares an `expires` instant. */
export interface MemoryExpiry {
  readonly path: string
  readonly expiresAtMs: number
}

/**
 * A compiled block plus why it is degraded: one reason per git read that failed (a timeout, lock contention) and
 * made the compile fall back, so a system file was left out or the projection ordered names without commit times.
 * A degraded block is right for this moment only and must never be persisted as the block of its commit.
 */
interface CompileReads {
  readonly degraded: string[]
}

export async function compileMemoryBlockWithReads(
  repo: GitMemoryRepo,
  revision: string | null,
  options: CompileMemoryBlockOptions,
  asOfMs: number = Date.now(),
): Promise<{ readonly block: string; readonly degraded: readonly string[]; readonly expiries: readonly MemoryExpiry[] }> {
  const reads: CompileReads = { degraded: [] }
  const paths = revision ? await repo.lsTree(revision) : []
  const persona = revision && paths.includes(PERSONA_PATH)
    ? await readSystemFile(repo, revision, PERSONA_PATH, reads)
    : undefined
  const identity = revision && paths.includes(IDENTITY_PATH)
    ? await readSystemFile(repo, revision, IDENTITY_PATH, reads)
    : undefined
  const agreements = revision && paths.includes(AGREEMENTS_PATH)
    ? await readSystemFile(repo, revision, AGREEMENTS_PATH, reads)
    : undefined
  const systemFiles = revision
    ? await readSystemFiles(repo, revision, paths.filter(isOtherSystemMarkdown), reads)
    : []
  const expiries = [persona, identity, agreements, ...systemFiles].flatMap((file) =>
    file?.expiresAtMs === undefined ? [] : [{ path: file.relativePath, expiresAtMs: file.expiresAtMs }])
  const live = (file: SystemFileRead | undefined) => file === undefined || isMemoryExpired(file.expiresAtMs, asOfMs) ? undefined : file
  const externalPaths = paths.filter(isExternalPath)
  const external = await projectionInput(repo, revision, externalPaths, options.projection)
  if (external.recencyUnavailable === true) reads.degraded.push(`commit times unavailable: ${external.recencyError ?? "unknown error"}`)
  // The listing renderer is a lazy sidecar in bundles that map `#memory-external-projection` (omo-senpi's omo.js).
  const listing = externalPaths.length === 0
    ? ""
    : (await import("#memory-external-projection")).renderExternalProjection(externalPaths, external)
  const projection = renderProjection(
    live(persona),
    live(identity),
    live(agreements),
    systemFiles.filter((file) => live(file) !== undefined),
    listing,
  )
  const metadata = renderMetadata(options)
  return { block: [projection, metadata].filter((part) => part.length > 0).join("\n\n"), degraded: reads.degraded, expiries }
}

/** What `<external_projection>` would show at `revision` under `limits`, without compiling the block. */
export async function externalProjectionStatsAt(
  repo: GitMemoryRepo,
  revision: string,
  limits: ExternalProjectionLimits = DEFAULT_EXTERNAL_PROJECTION_LIMITS,
): Promise<ExternalProjectionStats> {
  const externalPaths = (await repo.lsTree(revision)).filter(isExternalPath)
  const input = await projectionInput(repo, revision, externalPaths, limits)
  return (await import("#memory-external-projection")).renderExternalProjectionStats(externalPaths, input)
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
  } catch (error) {
    // Commit times only order names; without them the same limits apply in name order, and the
    // fallback is reported (`/doctor` projection) instead of silently changing the order.
    return { times: new Map(), limits, recencyUnavailable: true, recencyError: error instanceof Error ? error.message : String(error) }
  }
}

async function readSystemFiles(
  repo: GitMemoryRepo,
  revision: string,
  paths: readonly string[],
  reads: CompileReads,
): Promise<SystemFileRead[]> {
  const files = await Promise.all(paths.map((path) => readSystemFile(repo, revision, path, reads)))
  return files.filter((file): file is SystemFileRead => file !== undefined)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function readSystemFile(
  repo: GitMemoryRepo,
  revision: string,
  relativePath: string,
  reads: CompileReads,
): Promise<SystemFileRead | undefined> {
  let content: string
  try {
    content = await repo.show(revision, relativePath)
  } catch (error) {
    reads.degraded.push(`${relativePath} unread: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  try {
    const parsed = parseMemoryFile(content)
    const expiresAtMs = memoryExpiresAtMs(parsed.frontmatter)
    return {
      relativePath,
      body: redactSecretLikeMaterial(parsed.body),
      description: redactSecretLikeMaterial(parsed.frontmatter.description),
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    }
  } catch {
    return undefined
  }
}

function renderProjection(
  persona: CompiledSystemFile | undefined,
  identity: CompiledSystemFile | undefined,
  agreements: CompiledSystemFile | undefined,
  systemFiles: readonly CompiledSystemFile[],
  externalListing: string,
): string {
  const agreementsSection = agreements === undefined ? "" : renderAgreementsSection(agreements.body)
  if (!persona && !identity && !agreementsSection && systemFiles.length === 0 && externalListing.length === 0) return ""
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
  if (agreementsSection) lines.push("", agreementsSection)
  if (systemFiles.length > 0 || externalListing.length > 0) {
    lines.push("", "<memory>")
    if (systemFiles.length > 0) lines.push(renderSystemTree(systemFiles))
    if (externalListing.length > 0) lines.push(externalListing)
    lines.push("</memory>")
  }
  return lines.join("\n")
}

interface SystemFileRead extends CompiledSystemFile {
  readonly expiresAtMs?: number
}

function isOtherSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path !== PERSONA_PATH && path !== IDENTITY_PATH && path !== AGREEMENTS_PATH
    && path.endsWith(".md")
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
