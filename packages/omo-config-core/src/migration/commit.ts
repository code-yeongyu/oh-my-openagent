import { basename, dirname, join, resolve } from "node:path"
import { hasTamperedPrototype, isPlainObject, isUnsafeObjectKey } from "../internal/plain-object"
import { parseJsoncSafe } from "../internal/jsonc-parse"
import { toPosixPath } from "../internal/posix-path"
import { resolveHomeDir } from "../loader"
import { OMO_CONFIG_HARNESS_IDS, OMO_CONFIG_LEGACY_HARNESS_IDS, OmoConfigSchema, harnessBlockKey } from "../schema"
import { updateOmoConfig } from "../writer"
import { diffEdits, withoutMarker } from "./diff-edits"
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

function containerInTarget(target: Readonly<Record<string, unknown>>, path: readonly string[]): Record<string, unknown> | null {
  let container: Record<string, unknown> = target
  for (const segment of path) {
    const next = container[segment]
    if (!isPlainObject(next)) return null
    container = next
  }
  return container
}

/**
 * Mirrors loader semantics: unrecognized keys the user already carries in the target are tolerated
 * and reported as `kept:` diagnostics (the loader prunes unknown paths with a diagnostic instead of
 * dropping the layer), while keys the migration additions introduce, unsafe keys, and prototype
 * tampering stay fail-closed. Runs after stripRetiredCodegraph, so genuinely retired keys never
 * reach the tolerance path — they are removed with `removed:` diagnostics before validation.
 */
function validateTarget(
  targetPath: string,
  document: Readonly<Record<string, unknown>>,
  target: Readonly<Record<string, unknown>>,
): readonly string[] {
  const result = OmoConfigSchema.safeParse(document)
  if (result.success) return []
  const blocking: typeof result.error.issues = []
  const kept: string[] = []
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys" && !issue.keys.some((key) => isUnsafeObjectKey(key))) {
      const path = issue.path.map((segment) => String(segment))
      const container = containerInTarget(target, path)
      if (container !== null && issue.keys.every((key) => Object.prototype.hasOwnProperty.call(container, key))) {
        for (const key of issue.keys) {
          kept.push(`kept: ${[...path, key].join(".")} (unknown to migration schema, pre-existing in target, preserved verbatim)`)
        }
        continue
      }
    }
    blocking.push(issue)
  }
  if (blocking.length === 0) {
    if (!hasTamperedPrototype(document)) return kept
    throw new MigrationValidationError(targetPath, "the document contains prototype tampering")
  }
  const detail = blocking.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join(", ")
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

export const writeOmoMigrationTarget: MigrationTargetWriter = (input) => {
  const options = writerInput(input.targetPath, input.env)
  const result = updateOmoConfig({
    ...options,
    ...(input.backupPath === undefined ? {} : { backupPath: input.backupPath }),
    edits: input.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath,
  })
  if (!sameResolvedPath(result.path, input.targetPath)) {
    throw new MigrationTransactionError(`Migration writer resolved ${result.path} instead of ${input.targetPath}`)
  }
  return result.backupPath === undefined ? {} : { backupPath: result.backupPath }
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
  const keptDiagnostics = validateTarget(input.targetPath, document, targetCleanup.document)
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
    diagnostics: uniqueDiagnostics([...merged.diagnostics, ...targetCleanup.diagnostics, ...additionsCleanup.diagnostics, ...keptDiagnostics]),
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
  const keptDiagnostics = validateTarget(input.targetPath, document, targetCleanup.document)
  const edits: { path: readonly string[]; value: unknown }[] = [
    ...targetCleanup.edits,
    ...diffEdits(withoutMarker(targetCleanup.document), withoutMarker(documentCleanup.document)),
    { path: ["_migrations"], value: marker },
  ]
  return {
    diagnostics: uniqueDiagnostics([...targetCleanup.diagnostics, ...documentCleanup.diagnostics, ...keptDiagnostics]),
    document,
    edits,
  }
}

export function writePreparedTarget(input: {
  readonly backupPath?: string
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly prepared: PreparedTargetWrite
  readonly targetPath: string
  readonly writeTarget: MigrationTargetWriter
}): string | undefined {
  const written = input.writeTarget({
    ...(input.backupPath === undefined ? {} : { backupPath: input.backupPath }),
    edits: input.prepared.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath,
  })
  return written?.backupPath
}

export { parseDocument, targetDocument }
