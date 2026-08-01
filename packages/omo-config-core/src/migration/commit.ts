import { basename, dirname, join, resolve } from "node:path"
import { isPlainObject } from "../internal/plain-object"
import { parseJsoncSafe } from "../internal/jsonc-parse"
import { toPosixPath } from "../internal/posix-path"
import { resolveHomeDir } from "../loader"
import { OmoConfigSchema } from "../schema"
import { updateOmoConfig } from "../writer"
import { collectMigrationEdits, mergeWithoutClobber } from "./merge"
import { hasMigrationMarker } from "./predicate"
import { MigrationTransactionError, MigrationValidationError, type MigrationEnvironment, type MigrationFileSystem, type MigrationTargetWriter } from "./types"

function parseDocument(path: string, content: string): Record<string, unknown> {
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0 || !isPlainObject(parsed.data)) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ")
    throw new MigrationTransactionError(`Migration document at ${path} is not a JSONC object${detail === "" ? "" : `: ${detail}`}`)
  }
  return parsed.data
}

function targetDocument(path: string, fileSystem: MigrationFileSystem): Record<string, unknown> {
  if (!fileSystem.existsSync(path)) return {}
  return parseDocument(path, fileSystem.readFileSync(path, "utf-8"))
}

function markerValue(target: Readonly<Record<string, unknown>>, migrationId: string, targetPath: string): readonly string[] {
  const value = target["_migrations"]
  if (value === undefined) return [migrationId]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new MigrationValidationError(targetPath, "the existing migration marker must be an array of strings")
  }
  return hasMigrationMarker(target, migrationId) ? value : [...value, migrationId]
}

function validateTarget(targetPath: string, document: Readonly<Record<string, unknown>>): void {
  const result = OmoConfigSchema.safeParse(document)
  if (result.success) return
  const detail = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")
  throw new MigrationValidationError(targetPath, detail)
}

function writerInput(targetPath: string, env: MigrationEnvironment): { readonly projectDir?: string; readonly scope: "project" | "user" } {
  const homeDir = resolveHomeDir(env)
  const userDirectory = toPosixPath(join(homeDir, ".omo"))
  const fileName = basename(targetPath)
  if (toPosixPath(dirname(targetPath)) === userDirectory && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { scope: "user" }
  }
  if (basename(dirname(targetPath)) === ".omo" && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { projectDir: dirname(dirname(targetPath)), scope: "project" }
  }
  throw new MigrationTransactionError(`Migration target is not an omo config path: ${targetPath}`)
}

function sameResolvedPath(a: string, b: string): boolean {
  return toPosixPath(resolve(a)) === toPosixPath(resolve(b))
}

export const writeOmoMigrationTarget: MigrationTargetWriter = (input): void => {
  const options = writerInput(input.targetPath, input.env)
  const result = updateOmoConfig({
    ...options,
    edits: input.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath,
  })
  if (!sameResolvedPath(result.path, input.targetPath)) {
    throw new MigrationTransactionError(`Migration writer resolved ${result.path} instead of ${input.targetPath}`)
  }
}

export type PreparedTargetWrite = {
  readonly diagnostics: readonly string[]
  readonly document: Record<string, unknown>
  readonly edits: readonly { readonly path: readonly string[]; readonly value: unknown }[]
}

export function prepareTargetWrite(input: {
  readonly additions: Readonly<Record<string, unknown>>
  readonly migrationId: string
  readonly target: Readonly<Record<string, unknown>>
  readonly targetPath: string
}): PreparedTargetWrite {
  const merged = mergeWithoutClobber(input.target, input.additions)
  const marker = markerValue(input.target, input.migrationId, input.targetPath)
  const document = { ...merged.merged, _migrations: marker }
  validateTarget(input.targetPath, document)
  const edits = [...collectMigrationEdits(merged.additions), { path: ["_migrations"], value: marker }]
  return { diagnostics: merged.diagnostics, document, edits }
}

export function prepareTargetReplacement(input: {
  readonly document: Readonly<Record<string, unknown>>
  readonly migrationId: string
  readonly target: Readonly<Record<string, unknown>>
  readonly targetPath: string
}): PreparedTargetWrite {
  const marker = markerValue(input.target, input.migrationId, input.targetPath)
  const document = { ...input.document, _migrations: marker }
  validateTarget(input.targetPath, document)
  const edits: { path: readonly string[]; value: unknown }[] = []
  for (const key of Object.keys(input.target)) {
    if (key !== "_migrations" && !Object.prototype.hasOwnProperty.call(input.document, key)) {
      edits.push({ path: [key], value: undefined })
    }
  }
  for (const [key, value] of Object.entries(input.document)) {
    if (key !== "_migrations") edits.push({ path: [key], value })
  }
  edits.push({ path: ["_migrations"], value: marker })
  return { diagnostics: [], document, edits }
}

export function writePreparedTarget(input: {
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly prepared: PreparedTargetWrite
  readonly targetPath: string
  readonly writeTarget: MigrationTargetWriter
}): void {
  input.writeTarget({
    edits: input.prepared.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath,
  })
}

export { parseDocument, targetDocument }
