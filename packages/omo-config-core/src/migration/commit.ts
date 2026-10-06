import { basename, dirname, join, resolve } from "node:path"
import { isPlainObject } from "../internal/plain-object"
import { parseJsoncSafe } from "../internal/jsonc-parse"
import { toPosixPath } from "../internal/posix-path"
import { resolveHomeDir } from "../loader"
import { OMO_CONFIG_HARNESS_IDS, OMO_CONFIG_LEGACY_HARNESS_IDS, OmoConfigSchema, harnessBlockKey } from "../schema"
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

/**
 * Every harness block a config may carry, canonical and legacy, derived from the schema so this
 * list cannot drift. The legacy `[senpi]` block is renamed to `[native]` by a replace-target
 * migration whose output must be stripped too, otherwise a `[senpi].codegraph` leftover survives
 * the rename as `[native].codegraph` and strict validation still rejects the file.
 */
const OMO_HARNESS_BLOCKS: readonly string[] = [...OMO_CONFIG_HARNESS_IDS, ...OMO_CONFIG_LEGACY_HARNESS_IDS].map(harnessBlockKey)

type RetiredCodegraphCleanup = {
  readonly diagnostics: readonly string[]
  readonly document: Record<string, unknown>
  readonly edits: readonly { readonly path: readonly string[]; readonly value: undefined }[]
}

function stripRetiredCodegraph(document: Readonly<Record<string, unknown>>): RetiredCodegraphCleanup {
  const stripped = structuredClone(document)
  const removedPaths: string[][] = []
  const strip = (value: unknown, path: readonly string[]): void => {
    if (!isPlainObject(value)) return
    if (Object.prototype.hasOwnProperty.call(value, "codegraph")) {
      delete value.codegraph
      removedPaths.push([...path, "codegraph"])
    }
  }

  strip(stripped, [])
  for (const harness of OMO_HARNESS_BLOCKS) strip(stripped[harness], [harness])
  if (isPlainObject(stripped.profiles)) {
    for (const [profileName, profile] of Object.entries(stripped.profiles)) {
      strip(profile, ["profiles", profileName])
      if (!isPlainObject(profile)) continue
      for (const harness of OMO_HARNESS_BLOCKS) strip(profile[harness], ["profiles", profileName, harness])
    }
  }

  return {
    diagnostics: removedPaths.map((path) => `removed: ${path.join(".") || "codegraph"} (retired configuration)`),
    document: stripped,
    edits: removedPaths.map((path) => ({ path, value: undefined })),
  }
}

/** Target and transform output are stripped independently; a replace-target transform that passes the target through reports the same paths twice without this. */
function uniqueDiagnostics(diagnostics: readonly string[]): readonly string[] {
  return [...new Set(diagnostics)]
}

function validateTarget(targetPath: string, document: Readonly<Record<string, unknown>>): void {
  const result = OmoConfigSchema.safeParse(document)
  if (result.success) return
  const detail = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join(", ")
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
  const targetCleanup = stripRetiredCodegraph(input.target)
  const additionsCleanup = stripRetiredCodegraph(input.additions)
  const merged = mergeWithoutClobber(targetCleanup.document, additionsCleanup.document)
  const marker = markerValue(input.target, input.migrationId, input.targetPath)
  const document = { ...merged.merged, _migrations: marker }
  validateTarget(input.targetPath, document)
  // additionsCleanup strips codegraph from the migration transform output before merging.
  // Its edits are intentionally omitted here: migration transforms are source-controlled and
  // should never emit codegraph; even if they did, the merge would exclude it from the
  // resulting document, so no explicit delete edit is needed for the additions side.
  const edits = [
    ...targetCleanup.edits,
    ...collectMigrationEdits(merged.additions),
    { path: ["_migrations"], value: marker },
  ]
  return {
    diagnostics: uniqueDiagnostics([...merged.diagnostics, ...targetCleanup.diagnostics, ...additionsCleanup.diagnostics]),
    document,
    edits,
  }
}

export function prepareTargetReplacement(input: {
  readonly document: Readonly<Record<string, unknown>>
  readonly migrationId: string
  readonly target: Readonly<Record<string, unknown>>
  readonly targetPath: string
}): PreparedTargetWrite {
  const targetCleanup = stripRetiredCodegraph(input.target)
  const documentCleanup = stripRetiredCodegraph(input.document)
  const marker = markerValue(input.target, input.migrationId, input.targetPath)
  const document = { ...documentCleanup.document, _migrations: marker }
  validateTarget(input.targetPath, document)
  const edits: { path: readonly string[]; value: unknown }[] = [...targetCleanup.edits]
  for (const key of Object.keys(targetCleanup.document)) {
    if (key !== "_migrations" && !Object.prototype.hasOwnProperty.call(documentCleanup.document, key)) {
      edits.push({ path: [key], value: undefined })
    }
  }
  for (const [key, value] of Object.entries(documentCleanup.document)) {
    if (key !== "_migrations") edits.push({ path: [key], value })
  }
  edits.push({ path: ["_migrations"], value: marker })
  return {
    diagnostics: uniqueDiagnostics([...targetCleanup.diagnostics, ...documentCleanup.diagnostics]),
    document,
    edits,
  }
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
