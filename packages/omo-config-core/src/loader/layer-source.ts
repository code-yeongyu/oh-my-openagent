import { parse, printParseErrorCode } from "jsonc-parser/lib/esm/main.js"
import type * as z from "zod"

import { OmoConfigLayerSchema } from "../schema"
import { dropIgnoredGatewayPlacements, ignoredGatewayDiagnostic } from "./gateway"
import { isUnsafeObjectKey } from "./merge"
import type { OmoConfigDiagnostic, OmoConfigReadFileSystem, OmoConfigSource } from "./types"

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

export function validationDiagnostic(path: string, issues: readonly { readonly path: readonly PropertyKey[] }[]): OmoConfigDiagnostic {
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

/**
 * A layer carrying `__proto__`, `prototype`, or `constructor` is hostile input, not a stale key, so it
 * stays fail-closed (whole layer rejected) instead of being stripped and partially loaded.
 *
 * `prototype` and `constructor` arrive as own properties and surface here as unrecognized keys. A
 * JSON `"__proto__"` member does not: it is written THROUGH the prototype, so the schema sees only the
 * injected payload's inner keys, or nothing at all when a sub-schema rebuilds the object first. That
 * case is caught by `hasTamperedPrototype`, which runs on every layer before validation.
 */
function hasUnsafeUnrecognizedKey(issues: readonly UnrecognizedKeyIssue[]): boolean {
  return issues.some((issue) => issue.keys.some((key) => isUnsafeObjectKey(key)))
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

export type ConfigSourceRead = {
  readonly diagnostic?: OmoConfigDiagnostic
  // A gateway placement outside the user config's top level / [native] block, dropped before validation.
  readonly ignored?: OmoConfigDiagnostic
  readonly source: OmoConfigSource
  readonly value?: Record<string, unknown>
}

export function readConfigSource(
  path: string,
  scope: "project" | "user",
  fileSystem: OmoConfigReadFileSystem,
): ConfigSourceRead {
  if (!fileSystem.existsSync(path)) {
    return { source: { exists: false, loaded: false, path, scope } }
  }

  let content: string
  try {
    content = fileSystem.readFileSync(path, "utf-8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      diagnostic: { kind: "read", message: `Failed to read ${path}: ${message}`, path },
      source: { exists: true, loaded: false, path, scope },
    }
  }

  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0) {
    return {
      diagnostic: {
        kind: "parse",
        message: `JSONC parse error in ${path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
        path,
      },
      source: { exists: true, loaded: false, path, scope },
    }
  }

  // The guard runs before validation and reads `parsed.data` directly: `toRecord` rebuilds only the
  // root from its own enumerable properties, nested objects keep their prototype, and a valid layer
  // (nothing for zod to report) would otherwise hand a tampered sub-object to every consumer of it.
  if (hasTamperedPrototype(parsed.data)) {
    return {
      diagnostic: { kind: "validation", message: `Invalid omo config at ${path}: "__proto__" member is not allowed`, path },
      source: { exists: true, loaded: false, path, scope },
    }
  }

  const gateway = dropIgnoredGatewayPlacements(parsed.data, scope)
  const validated = validateConfigLayer(path, scope, gateway.document)
  return gateway.ignored.length === 0 ? validated : { ...validated, ignored: ignoredGatewayDiagnostic(path, gateway.ignored) }
}

function validateConfigLayer(path: string, scope: "project" | "user", data: unknown): ConfigSourceRead {
  const parsedRecord = toRecord(data)
  const validation = OmoConfigLayerSchema.safeParse(data)
  if (!validation.success) {
    const unrecognized = unrecognizedKeyIssues(validation.error.issues)
    if (hasUnsafeUnrecognizedKey(unrecognized)) {
      return {
        diagnostic: validationDiagnostic(path, validation.error.issues),
        source: { exists: true, loaded: false, path, scope },
      }
    }
    const rejected = {
      diagnostic: validationDiagnostic(path, validation.error.issues),
      source: { exists: true, loaded: false, path, scope },
    } as const
    const unknownIssues = unrecognizedKeyIssues(validation.error.issues)
    if (parsedRecord === null || unknownIssues.length === 0) return rejected

    const { issuePaths, stripped } = stripUnrecognizedKeys(parsedRecord, unknownIssues)
    if (!OmoConfigLayerSchema.safeParse(stripped).success) return rejected

    return {
      diagnostic: {
        kind: "unknown-keys",
        message: `Ignored unknown keys in ${path}: ${issuePaths.join(", ")}`,
        path,
        issuePaths,
      },
      source: { exists: true, loaded: true, path, scope },
      value: stripped,
    }
  }
  if (parsedRecord === null) {
    return {
      diagnostic: { kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path },
      source: { exists: true, loaded: false, path, scope },
    }
  }

  return {
    source: { exists: true, loaded: true, path, scope },
    value: parsedRecord,
  }
}
