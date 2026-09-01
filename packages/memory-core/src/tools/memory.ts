import { existsSync } from "../fs/resilient"
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "../fs/resilient"
import { dirname, join, relative } from "node:path"
import { NoEffectiveChangesError, type GitCommitAuthor, type GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile, type ParsedMemoryFile } from "../memfs/frontmatter"
import { validateMemoryPath, validateRepositoryPath } from "../memfs/paths"
import type { LockDomain } from "../locks"
import { SOUL_EDIT_RESULT_LINE, touchesSoulPath } from "../soul"
import { MemoryToolError } from "./tool-errors"

export type MemoryCommand =
  | "create"
  | "str_replace"
  | "insert"
  | "delete"
  | "rename"
  | "update_description"

export interface MemoryToolProvenance {
  readonly sessionId: string
  readonly userTurns: number
}

export interface MemoryToolParams {
  command: MemoryCommand
  reason: string
  author: GitCommitAuthor
  provenance?: MemoryToolProvenance
  file_path?: string
  old_path?: string
  new_path?: string
  old_string?: string
  new_string?: string
  insert_line?: number
  insert_text?: string
  description?: string
  file_text?: string
}

/** Post-commit metadata carried to the notice channel (plan IC-4); subject is the message's first line. */
export interface MemoryToolCommit {
  readonly sha: string
  readonly subject: string
  readonly affectedPaths: readonly string[]
}

export interface MemoryToolResult {
  message: string
  readonly commit?: MemoryToolCommit
}

export interface MemoryToolLock {
  <T>(domain: LockDomain, operation: () => Promise<T>): Promise<T>
}

export interface RunMemoryToolOptions {
  repo: GitMemoryRepo
  lock: MemoryToolLock
  params: MemoryToolParams
}

type AppliedCommand = { affectedPaths: string[] }

export async function runMemoryTool(options: RunMemoryToolOptions): Promise<MemoryToolResult> {
  const { repo, lock, params } = options
  try {
    const reason = required(params.reason, "reason").trim()
    return await lock("memory-write", async () => {
      await repo.cleanCheck()
      const { affectedPaths } = await applyCommand(repo.dir, params)
      if (affectedPaths.length === 0) {
        throw toolError(`${params.command} made no changes`)
      }

      let result
      try {
        result = await repo.commitWrite(affectedPaths, memoryCommitMessage(reason, params.provenance), params.author)
      } catch (error) {
        if (error instanceof NoEffectiveChangesError) {
          throw toolError(`${params.command} made no effective changes`, error)
        }
        throw error
      }

      const local = !(await hasConfiguredRemote(repo))
      const summary = local
        ? `Memory ${params.command} committed locally (${result.sha.slice(0, 7)}).`
        : `Memory ${params.command} committed (${result.sha.slice(0, 7)}); harness will sync after the turn.`
      return {
        message: touchesSoulPath(affectedPaths) ? `${summary}\n${SOUL_EDIT_RESULT_LINE}` : summary,
        commit: {
          sha: result.sha,
          subject: reason.split(/\r?\n/, 1)[0] ?? reason,
          affectedPaths,
        },
      }
    })
  } catch (error) {
    if (error instanceof MemoryToolError) throw error
    throw toolError(errorMessage(error), error)
  }
}

async function applyCommand(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  switch (params.command) {
    case "create": return create(root, params)
    case "str_replace": return strReplace(root, params)
    case "insert": return insert(root, params)
    case "delete": return remove(root, params)
    case "rename": return move(root, params)
    case "update_description": return updateDescription(root, params)
  }
}

async function create(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const source = required(params.file_path, "file_path", "create")
  const description = required(params.description, "description", "create")
  const path = validateMemoryPath(root, source, { fieldName: "file_path" })
  if (existsSync(path)) throw toolError(`create: block already exists at ${source}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, renderMemoryFile({ description }, params.file_text ?? ""), "utf8")
  return affected(root, path)
}

async function strReplace(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const source = required(params.file_path, "file_path", "str_replace")
  const oldString = required(params.old_string, "old_string", "str_replace")
  const newString = required(params.new_string, "new_string", "str_replace")
  const path = validateMemoryPath(root, source, { fieldName: "file_path" })
  const file = await loadEditable(path, source)
  const index = file.body.indexOf(oldString)
  if (index < 0) throw toolError("str_replace: old_string was not found in the target memory block")
  const body = file.body.slice(0, index) + newString + file.body.slice(index + oldString.length)
  await writeFile(path, renderMemoryFile(file.frontmatter, body), "utf8")
  return affected(root, path)
}

async function insert(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const source = required(params.file_path, "file_path", "insert")
  const text = required(params.insert_text, "insert_text", "insert")
  if (typeof params.insert_line !== "number" || Number.isNaN(params.insert_line)) {
    throw toolError("insert: 'insert_line' must be a number")
  }
  const path = validateMemoryPath(root, source, { fieldName: "file_path" })
  const file = await loadEditable(path, source)
  const lines = file.body.length > 0 ? file.body.split("\n") : []
  const line = Math.max(1, Math.floor(params.insert_line))
  lines.splice(Math.min(line - 1, lines.length), 0, ...text.split("\n"))
  await writeFile(path, renderMemoryFile(file.frontmatter, lines.join("\n")), "utf8")
  return affected(root, path)
}

async function remove(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const source = required(params.file_path, "file_path", "delete")
  const repositoryPath = validateRepositoryPath(root, source, "file_path")
  if (existsSync(repositoryPath) && (await stat(repositoryPath)).isDirectory()) {
    await assertDirectoryEditable(repositoryPath, root)
    const tracked = await collectFiles(repositoryPath, root)
    await rm(repositoryPath, { recursive: true, force: false })
    return { affectedPaths: tracked }
  }
  const path = validateMemoryPath(root, source, { fieldName: "file_path" })
  await loadEditable(path, source)
  await unlink(path)
  return affected(root, path)
}

async function move(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const oldSource = required(params.old_path, "old_path", "rename")
  const newSource = required(params.new_path, "new_path", "rename")
  const oldPath = validateMemoryPath(root, oldSource, { fieldName: "old_path" })
  const newPath = validateMemoryPath(root, newSource, { fieldName: "new_path" })
  if (existsSync(newPath)) throw toolError(`rename: destination already exists at ${newSource}`)
  await loadEditable(oldPath, oldSource)
  await mkdir(dirname(newPath), { recursive: true })
  await rename(oldPath, newPath)
  return { affectedPaths: [relativePath(root, oldPath), relativePath(root, newPath)] }
}

async function updateDescription(root: string, params: MemoryToolParams): Promise<AppliedCommand> {
  const source = required(params.file_path, "file_path", "update_description")
  const description = required(params.description, "description", "update_description")
  const path = validateMemoryPath(root, source, { fieldName: "file_path" })
  const file = await loadEditable(path, source)
  await writeFile(path, renderMemoryFile({ ...file.frontmatter, description }, file.body), "utf8")
  return affected(root, path)
}

async function loadEditable(path: string, source: string): Promise<ParsedMemoryFile> {
  const content = await readUtf8(path, source)
  const parsed = parseMemoryFile(content)
  if (parsed.frontmatter.read_only === "true") {
    throw toolError(`${source} is read_only and cannot be modified`)
  }
  return parsed
}

async function readUtf8(path: string, source: string): Promise<string> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    throw toolError(`failed to read ${source}: ${errorMessage(error)}`, error)
  }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw toolError(`${source} is UTF-16 encoded; convert it to UTF-8 before using the memory tool`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw toolError(`${source} is not valid UTF-8; convert it to UTF-8 before using the memory tool`, error)
  }
}

async function assertDirectoryEditable(directory: string, root: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await assertDirectoryEditable(path, root)
    else if (entry.isFile() && entry.name.endsWith(".md")) await loadEditable(path, relativePath(root, path))
  }
}

async function collectFiles(directory: string, root: string): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await collectFiles(path, root))
    else if (entry.isFile()) paths.push(relativePath(root, path))
  }
  return paths
}

function affected(root: string, path: string): AppliedCommand {
  return { affectedPaths: [relativePath(root, path)] }
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/")
}

function required(value: string | undefined, field: string, command?: MemoryCommand): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw toolError(`${command ? `${command}: ` : ""}'${field}' must be a non-empty string`)
  }
  return value
}

async function hasConfiguredRemote(repo: GitMemoryRepo): Promise<boolean> {
  const gitConfig = await readFile(join(repo.dir, ".git", "config"), "utf8").catch(() => "")
  return /^\s*\[remote\s+"[^"]+"\]/m.test(gitConfig)
}

function toolError(message: string, cause?: unknown): MemoryToolError {
  return new MemoryToolError(message, cause === undefined ? undefined : { cause })
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
