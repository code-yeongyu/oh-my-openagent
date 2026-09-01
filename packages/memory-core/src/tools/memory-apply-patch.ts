import { access, mkdir, readFile, unlink, writeFile } from "../fs/resilient"
import { dirname, join, relative } from "node:path"

import { NoEffectiveChangesError, type GitCommitAuthor, type GitMemoryRepo } from "../git"
import { SOUL_EDIT_RESULT_LINE, touchesSoulPath } from "../soul"
import type { MemoryToolCommit, MemoryToolProvenance } from "./memory"
import { parseMemoryFile, renderMemoryFile } from "../memfs/frontmatter"
import { MemoryPathError, validateMemoryPath } from "../memfs/paths"
import type { LockDomain } from "../locks"
import {
  applyMemoryPatchHunk,
  MemoryPatchHunkError,
  MemoryPatchParseError,
  parseMemoryPatch,
  type PatchOperation,
} from "./patch-parser"

export { MemoryPatchHunkError } from "./patch-parser"

export interface MemoryApplyPatchParams {
  readonly reason: string
  readonly input: string
  readonly author: GitCommitAuthor
  readonly provenance?: MemoryToolProvenance
}

export interface MemoryApplyPatchResult {
  readonly message: string
  readonly commit?: MemoryToolCommit
}

export interface MemoryApplyPatchLock {
  <T>(domain: LockDomain, operation: () => Promise<T>): Promise<T>
}

export interface RunMemoryApplyPatchOptions {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryApplyPatchLock
  readonly params: MemoryApplyPatchParams
}

export class MemoryApplyPatchError extends Error {
  override readonly name: string = "MemoryApplyPatchError"

  constructor(message: string, options?: ErrorOptions) {
    super(message.startsWith("memory_apply_patch:") ? message : `memory_apply_patch: ${message}`, options)
  }
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

export async function runMemoryApplyPatch(
  options: RunMemoryApplyPatchOptions,
): Promise<MemoryApplyPatchResult> {
  const { repo, lock, params } = options
  try {
    const reason = typeof params.reason === "string" ? params.reason.trim() : ""
    if (reason.length === 0) throw new MemoryApplyPatchError("'reason' must be a non-empty string")
    if (typeof params.input !== "string" || params.input.trim().length === 0) {
      throw new MemoryApplyPatchError("'input' must be a non-empty string")
    }

    return await lock("memory-write", async () => {
      await repo.cleanCheck()
      const paths = await applyOperations(repo.dir, parseMemoryPatch(params.input))
      let result
      try {
        result = await repo.commitWrite(paths, memoryCommitMessage(reason, params.provenance), params.author)
      } catch (error) {
        if (error instanceof NoEffectiveChangesError) {
          throw new MemoryApplyPatchError(
            "made no effective changes; nothing was committed. " +
            "The patched content matched what was already on disk.",
            { cause: error },
          )
        }
        throw error
      }

      const shortSha = result.sha.slice(0, 7)
      const local = !(await hasConfiguredRemote(repo))
      const summary = local
        ? `memory_apply_patch committed locally (${shortSha}).`
        : `memory_apply_patch committed (${shortSha}); harness will sync after the turn.`
      return {
        message: touchesSoulPath(paths) ? `${summary}\n${SOUL_EDIT_RESULT_LINE}` : summary,
        commit: {
          sha: result.sha,
          subject: reason.split(/\r?\n/, 1)[0] ?? reason,
          affectedPaths: paths,
        },
      }
    })
  } catch (error) {
    if (
      error instanceof MemoryApplyPatchError ||
      error instanceof MemoryPatchParseError ||
      error instanceof MemoryPatchHunkError
    ) throw error
    throw new MemoryApplyPatchError(errorMessage(error), { cause: error })
  }
}

async function applyOperations(root: string, operations: readonly PatchOperation[]): Promise<string[]> {
  const pendingWrites = new Map<string, string>()
  const pendingDeletes = new Set<string>()
  const affectedPaths = new Set<string>()

  const resolvePath = (input: string, fieldName: string): { absolute: string; relative: string } => {
    try {
      const absolute = validateMemoryPath(root, input, { fieldName })
      return { absolute, relative: relative(root, absolute).replace(/\\/g, "/") }
    } catch (error) {
      if (!(error instanceof MemoryPathError)) throw error
      const detail = error.message
        .replace(/^memory path: /, "")
        .replace("The memory tool", "The memory_apply_patch tool")
      throw new Error(`memory_apply_patch: ${detail}`)
    }
  }

  const loadCurrent = async (path: { absolute: string; relative: string }): Promise<string> => {
    if (pendingDeletes.has(path.absolute) && !pendingWrites.has(path.absolute)) {
      throw new Error(`memory_apply_patch: file not found for update: ${path.relative}`)
    }
    const pending = pendingWrites.get(path.absolute)
    if (pending !== undefined) return pending
    try {
      return (await readUtf8TextStrict(path.absolute)).replace(/\r\n/g, "\n")
    } catch (error) {
      throw new Error(`memory_apply_patch: failed to read ${path.relative}: ${errorMessage(error)}`)
    }
  }

  for (const operation of operations) {
    if (operation.kind === "add") {
      const target = resolvePath(operation.targetPath, "Add File path")
      if (pendingWrites.has(target.absolute)) {
        throw new Error(`memory_apply_patch: duplicate add/update target in patch: ${target.relative}`)
      }
      if (await exists(target.absolute)) {
        throw new Error(`memory_apply_patch: cannot add existing memory file: ${target.relative}`)
      }
      const rawContent = operation.contentLines.join("\n")
      pendingWrites.set(target.absolute, normalizeAddedContent(target.relative.slice(0, -3), rawContent))
      pendingDeletes.delete(target.absolute)
      affectedPaths.add(target.relative)
      continue
    }

    if (operation.kind === "delete") {
      const target = resolvePath(operation.targetPath, "Delete File path")
      const parsed = parseForTool(await loadCurrent(target))
      assertEditable(parsed.frontmatter.read_only, target.relative)
      pendingWrites.delete(target.absolute)
      pendingDeletes.add(target.absolute)
      affectedPaths.add(target.relative)
      continue
    }

    const source = resolvePath(operation.sourcePath, "Update File path")
    const target = resolvePath(operation.targetPath, "Move to path")
    const current = await loadCurrent(source)
    assertEditable(parseForTool(current).frontmatter.read_only, source.relative)

    let next = current
    for (const hunk of operation.hunks) next = applyMemoryPatchHunk(next, hunk, source.relative)
    if (parseForTool(next).frontmatter.read_only === "true") {
      throw new Error(`memory_apply_patch: ${target.relative} cannot be written with read_only=true`)
    }

    pendingWrites.set(target.absolute, next)
    pendingDeletes.delete(target.absolute)
    affectedPaths.add(target.relative)
    if (source.absolute !== target.absolute) {
      pendingWrites.delete(source.absolute)
      pendingDeletes.add(source.absolute)
      affectedPaths.add(source.relative)
    }
  }

  for (const [path, content] of pendingWrites) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(content, "utf8"))
  }
  for (const path of pendingDeletes) {
    if (!pendingWrites.has(path) && await exists(path)) await unlink(path)
  }
  return [...affectedPaths]
}

function parseForTool(content: string): ReturnType<typeof parseMemoryFile> {
  try {
    return parseMemoryFile(content)
  } catch (error) {
    throw new Error(`memory_apply_patch: ${errorMessage(error).replace(/^frontmatter: /, "")}`)
  }
}

function normalizeAddedContent(label: string, rawContent: string): string {
  try {
    const parsed = parseMemoryFile(rawContent)
    return renderMemoryFile(parsed.frontmatter, parsed.body)
  } catch {
    return renderMemoryFile({ description: `Memory block ${label}` }, rawContent)
  }
}

function assertEditable(readOnly: string | undefined, path: string): void {
  if (readOnly === "true") throw new Error(`memory_apply_patch: ${path} is read_only and cannot be modified`)
}

async function readUtf8TextStrict(path: string): Promise<string> {
  const bytes = await readFile(path)
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe
    ? "UTF-16LE"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "UTF-16BE" : null
  if (bom !== null) {
    throw new Error(`File is not valid UTF-8 text: ${path}. Detected ${bom} BOM; convert the file to UTF-8 and retry.`)
  }
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${path}. The file contains bytes that cannot be decoded as UTF-8.`)
  }
}

async function hasConfiguredRemote(repo: GitMemoryRepo): Promise<boolean> {
  const gitConfig = await readFile(join(repo.dir, ".git", "config"), "utf8").catch(() => "")
  return /^\s*\[remote\s+"[^"]+"\]/m.test(gitConfig)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function memoryCommitMessage(reason: string, provenance: MemoryToolProvenance | undefined): string {
  if (provenance === undefined) return reason
  return [
    reason,
    "",
    "Omo-Writer: memory-tool",
    `Omo-Session: ${provenance.sessionId}`,
    `Omo-Turn: ${provenance.userTurns}`,
  ].join("\n")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
