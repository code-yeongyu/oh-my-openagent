import { access, mkdir, readFile, unlink, writeFile } from "../fs/resilient"
import { dirname, relative } from "node:path"

import { parseMemoryFile, renderMemoryFile } from "../memfs/frontmatter"
import { MemoryPathError, validateMemoryPath } from "../memfs/paths"
import {
  applyMemoryPatchHunk,
  MemoryPatchHunkError,
  MemoryPatchParseError,
  parseMemoryPatch,
  type PatchOperation,
} from "./patch-parser"

export { MemoryPatchHunkError, MemoryPatchParseError }

export async function applyMemoryPatch(root: string, input: string): Promise<string[]> {
  return applyOperations(root, parseMemoryPatch(input))
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
      const detail = error.message.replace(/^memory path: /, "")
      throw new Error(`memory apply_patch: ${detail}`)
    }
  }

  const loadCurrent = async (path: { absolute: string; relative: string }): Promise<string> => {
    if (pendingDeletes.has(path.absolute) && !pendingWrites.has(path.absolute)) {
      throw new Error(`memory apply_patch: file not found for update: ${path.relative}`)
    }
    const pending = pendingWrites.get(path.absolute)
    if (pending !== undefined) return pending
    try {
      return (await readUtf8TextStrict(path.absolute)).replace(/\r\n/g, "\n")
    } catch (error) {
      throw new Error(`memory apply_patch: failed to read ${path.relative}: ${errorMessage(error)}`)
    }
  }

  for (const operation of operations) {
    if (operation.kind === "add") {
      const target = resolvePath(operation.targetPath, "Add File path")
      if (pendingWrites.has(target.absolute)) {
        throw new Error(`memory apply_patch: duplicate add/update target in patch: ${target.relative}`)
      }
      if (await exists(target.absolute)) {
        throw new Error(`memory apply_patch: cannot add existing memory file: ${target.relative}`)
      }
      pendingWrites.set(target.absolute, normalizeAddedContent(target.relative.slice(0, -3), operation.contentLines.join("\n")))
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
      throw new Error(`memory apply_patch: ${target.relative} cannot be written with read_only=true`)
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
    throw new Error(`memory apply_patch: ${errorMessage(error).replace(/^frontmatter: /, "")}`)
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
  if (readOnly === "true") throw new Error(`memory apply_patch: ${path} is read_only and cannot be modified`)
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

async function readUtf8TextStrict(path: string): Promise<string> {
  const bytes = await readFile(path)
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe
    ? "UTF-16LE"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "UTF-16BE" : null
  if (bom !== null) throw new Error(`File is not valid UTF-8 text: ${path}. Detected ${bom} BOM; convert it to UTF-8 and retry.`)
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${path}. The file contains bytes that cannot be decoded as UTF-8.`)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
