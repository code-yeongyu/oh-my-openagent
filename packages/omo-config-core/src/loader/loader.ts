import { parse, printParseErrorCode } from "jsonc-parser/lib/esm/main.js"
import type * as z from "zod"

import { OmoConfigLayerSchema, OmoConfigSchema, resolveOmoTaskSettings, type OmoConfig } from "../schema"
import { isUnsafeObjectKey, mergeOmoConfigRecords } from "./merge"
import { resolveOmoConfigPaths } from "./paths"
import { pruneInvalidConfigLeaves } from "./prune-invalid-leaves"
import { resolveOmoConfigView, resolveOmoProfileName } from "./resolution"
import {
  DEFAULT_READ_FILE_SYSTEM,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfigDiagnostic,
  type OmoConfigRawLayer,
  type OmoConfigReadFileSystem,
  type OmoConfigSource,
} from "./types"

type JsoncParseResult<T> = {
  readonly data: T | null
  readonly errors: readonly { readonly message: string; readonly offset: number }[]
}

function parseJsoncSafe<T>(content: string): JsoncParseResult<T> {
  const errors: { error: number; length: number; offset: number }[] = []
  const data = parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T | null

  return {
    data: errors.length === 0 ? data : null,
    errors: errors.map((error) => ({
      message: printParseErrorCode(error.error),
      offset: error.offset,
    })),
  }
}

const DEFAULT_RAW_CONFIG: Record<string, unknown> = {
  agents: {},
  categories: {},
  task: resolveOmoTaskSettings({}),
  teams: {},
}

function stripResolutionControlKeys(config: OmoConfig): OmoConfig {
  const {
    "[codex]": _codex,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config
  return resolved
}

function validationDiagnostic(path: string, issues: readonly { readonly path: readonly PropertyKey[] }[]): OmoConfigDiagnostic {
  const issuePaths = issues.map((issue) => issue.path.map((segment) => String(segment)).join("."))
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths,
  }
}

type UnrecognizedKeyIssue = {
  readonly keys: readonly string[]
  readonly path: readonly string[]
}

function unrecognizedKeyIssues(issues: readonly z.core.$ZodIssue[]): readonly UnrecognizedKeyIssue[] {
  return issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? [{ keys: issue.keys, path: issue.path.map((segment) => String(segment)) }]
      : [],
  )
}

function isRecordLeafIssue(issue: readonly PropertyKey[]): boolean {
  const segments = issue.map((segment) => String(segment))
  if (segments.length < 2) return false
  return segments[0] === "agents" || segments[0] === "categories"
}

function hasOnlyRecordLeafIssues(issues: readonly z.core.$ZodIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => isRecordLeafIssue(issue.path))
}

/**
 * A layer carrying `__proto__`, `prototype`, or `constructor` is hostile input, not a stale key, so it
 * stays fail-closed (whole layer rejected) instead of being stripped and partially loaded — at ANY
 * depth, which is why the tamper check runs unconditionally on the validation-failure path.
 *
 * The unrecognized key alone is not the signal: a JSON `"__proto__"` member is written THROUGH the
 * prototype rather than becoming an own property, so the parsed record reports only the injected
 * payload's inner keys (`polluted`) and never `__proto__` itself. Detect the tampering directly.
 * Zod surfaces those inherited payload keys as `unrecognized_keys` only at the layer root, so
 * nesting hostile input under `agents.*`/`categories.*` leaves no unrecognized-key issue at all;
 * `hasTamperedPrototype` is what catches it there.
 */
function hasUnsafeUnrecognizedKey(parsed: unknown, issues: readonly UnrecognizedKeyIssue[]): boolean {
  if (issues.some((issue) => issue.keys.some((key) => isUnsafeObjectKey(key)))) return true
  return hasTamperedPrototype(parsed)
}

function hasTamperedPrototype(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasTamperedPrototype(entry))
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return true
  return Object.values(value).some((entry) => hasTamperedPrototype(entry))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function containerAt(record: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  let container: Record<string, unknown> = record
  for (const segment of path) {
    const next = container[segment]
    if (!isRecord(next)) return null
    container = next
  }
  return container
}

/** Delete every unrecognized key reported by zod, returning the pruned clone plus the dotted path of each removal. */
function stripUnrecognizedKeys(
  record: Record<string, unknown>,
  issues: readonly UnrecognizedKeyIssue[],
): { readonly issuePaths: readonly string[]; readonly stripped: Record<string, unknown> } {
  const stripped = structuredClone(record)
  const issuePaths: string[] = []
  for (const issue of issues) {
    const container = containerAt(stripped, issue.path)
    if (container === null) continue
    for (const key of issue.keys) {
      delete container[key]
      issuePaths.push([...issue.path, key].join("."))
    }
  }
  return { issuePaths, stripped }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }
  return record
}

function readConfigSource(
  path: string,
  scope: "project" | "user",
  fileSystem: OmoConfigReadFileSystem,
): {
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly source: OmoConfigSource
  readonly value?: Record<string, unknown>
} {
  if (!fileSystem.existsSync(path)) {
    return { diagnostics: [], source: { exists: false, loaded: false, path, scope } }
  }

  let content: string
  try {
    content = fileSystem.readFileSync(path, "utf-8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      diagnostics: [{ kind: "read", message: `Failed to read ${path}: ${message}`, path }],
      source: { exists: true, loaded: false, path, scope },
    }
  }

  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0) {
    return {
      diagnostics: [{
        kind: "parse",
        message: `JSONC parse error in ${path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
        path,
      }],
      source: { exists: true, loaded: false, path, scope },
    }
  }

  const parsedRecord = toRecord(parsed.data)
  const validation = OmoConfigLayerSchema.safeParse(parsed.data)
  if (!validation.success) {
    // NOTE: the guard reads `parsed.data` directly. `toRecord` rebuilds the object from its own
    // enumerable properties, which silently discards the tampered prototype this guard looks for.
    const unrecognized = unrecognizedKeyIssues(validation.error.issues)
    if (hasUnsafeUnrecognizedKey(parsed.data, unrecognized)) {
      return {
        diagnostics: [validationDiagnostic(path, validation.error.issues)],
        source: { exists: true, loaded: false, path, scope },
      }
    }
    const rejected = {
      diagnostics: [validationDiagnostic(path, validation.error.issues)],
      source: { exists: true, loaded: false, path, scope },
    } as const
    if (parsedRecord === null) return rejected

    // Gate order on the failure path: (1) the prototype-pollution guard above stays fail-closed
    // and is never pruned past; (2) unknown keys are stripped exactly as before; (3) only when
    // every remaining issue targets an `agents.*`/`categories.*` leaf are those leaves pruned.
    let candidate = parsedRecord
    let issues: readonly z.core.$ZodIssue[] = validation.error.issues
    let priorDiagnostics: readonly OmoConfigDiagnostic[] = []
    const unknownIssues = unrecognizedKeyIssues(validation.error.issues)
    if (unknownIssues.length > 0) {
      const { issuePaths, stripped } = stripUnrecognizedKeys(parsedRecord, unknownIssues)
      const strippedValidation = OmoConfigLayerSchema.safeParse(stripped)
      const unknownKeysDiagnostic: OmoConfigDiagnostic = {
        kind: "unknown-keys",
        message: `Ignored unknown keys in ${path}: ${issuePaths.join(", ")}`,
        path,
        issuePaths,
      }
      if (strippedValidation.success) {
        return {
          diagnostics: [unknownKeysDiagnostic],
          source: { exists: true, loaded: true, path, scope },
          value: stripped,
        }
      }
      candidate = stripped
      issues = strippedValidation.error.issues
      priorDiagnostics = [unknownKeysDiagnostic]
    }

    if (!hasOnlyRecordLeafIssues(issues)) return rejected
    const pruned = pruneInvalidConfigLeaves(candidate, issues, (record) => {
      const parsed = OmoConfigLayerSchema.safeParse(record)
      return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues }
    })
    if (Object.keys(pruned.config).length === 0) return rejected
    return {
      diagnostics: [...priorDiagnostics, ...pruned.dropped],
      source: { exists: true, loaded: true, path, scope },
      value: pruned.config,
    }
  }
  if (parsedRecord === null) {
    return {
      diagnostics: [{ kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path }],
      source: { exists: true, loaded: false, path, scope },
    }
  }

  return {
    diagnostics: [],
    source: { exists: true, loaded: true, path, scope },
    value: parsedRecord,
  }
}

export function loadOmoConfig(options: LoadOmoConfigOptions = {}): LoadOmoConfigResult {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM
  const cwd = options.cwd ?? process.cwd()
  let merged: Record<string, unknown> = {}
  const diagnostics: OmoConfigDiagnostic[] = []
  const layers: OmoConfigRawLayer[] = []
  const sources: OmoConfigSource[] = []

  for (const candidate of resolveOmoConfigPaths({
    cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    fileSystem,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  })) {
    const loaded = readConfigSource(candidate.path, candidate.scope, fileSystem)
    sources.push(loaded.source)
    diagnostics.push(...loaded.diagnostics)
    if (loaded.value !== undefined) {
      layers.push({ config: loaded.value, source: loaded.source })
      merged = mergeOmoConfigRecords(merged, loaded.value)
    }
  }

  const requestedProfile = resolveOmoProfileName({
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  })
  const resolved = resolveOmoConfigView({
    config: merged,
    ...(options.harness === undefined ? {} : { harness: options.harness }),
    ...(requestedProfile === undefined ? {} : { profile: requestedProfile }),
  })
  const finalConfig = OmoConfigSchema.safeParse(mergeOmoConfigRecords(DEFAULT_RAW_CONFIG, resolved.config))
  if (finalConfig.success) {
    return {
      config: stripResolutionControlKeys(finalConfig.data),
      diagnostics: [...diagnostics, ...resolved.diagnostics],
      layers,
      ...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
      sources,
    }
  }

  return {
    config: stripResolutionControlKeys(OmoConfigSchema.parse(DEFAULT_RAW_CONFIG)) satisfies OmoConfig,
    diagnostics: [...diagnostics, ...resolved.diagnostics, validationDiagnostic("(merged omo config)", finalConfig.error.issues)],
    layers,
    ...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
    sources,
  }
}
