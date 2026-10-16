import type * as z from "zod"

import { OmoConfigLayerSchema } from "../schema"
import { isUnsafeObjectKey } from "./merge"
import { pruneInvalidConfigPaths, type PrunedConfigPath, type PruneValidator } from "./prune-invalid-leaves"
import type { OmoConfigDiagnostic } from "./types"

export type OmoConfigLayerValidation =
  | { readonly loaded: true; readonly diagnostics: readonly OmoConfigDiagnostic[]; readonly value: Record<string, unknown> }
  | { readonly loaded: false; readonly diagnostics: readonly OmoConfigDiagnostic[] }

export function validationDiagnostic(path: string, issues: readonly { readonly path: readonly PropertyKey[] }[]): OmoConfigDiagnostic {
  const issuePaths = issues.map((issue) => issue.path.map((segment) => String(segment)).join("."))
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths,
  }
}

export function invalidValueDiagnostics(path: string, dropped: readonly PrunedConfigPath[]): readonly OmoConfigDiagnostic[] {
  return dropped.map((entry) => ({
    kind: "invalid-value",
    message: `Ignored invalid value in ${path}: ${entry.key}: ${entry.message}`,
    path,
    issuePaths: [entry.key],
  }))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sanitizeUnsafeKeys(
  value: unknown,
  path: readonly string[] = [],
): { readonly issues: readonly UnrecognizedKeyIssue[]; readonly value: unknown } {
  if (Array.isArray(value)) {
    const issues: UnrecognizedKeyIssue[] = []
    const sanitized = value.map((entry, index) => {
      const nested = sanitizeUnsafeKeys(entry, [...path, String(index)])
      issues.push(...nested.issues)
      return nested.value
    })
    return { issues, value: sanitized }
  }
  if (!isRecord(value)) return { issues: [], value }

  const issues: UnrecognizedKeyIssue[] = []
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    issues.push({ keys: ["__proto__"], path })
  }
  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) {
      issues.push({ keys: [key], path })
      continue
    }
    const nested = sanitizeUnsafeKeys(entry, [...path, key])
    issues.push(...nested.issues)
    sanitized[key] = nested.value
  }
  return { issues, value: sanitized }
}

/** The object an unrecognized-keys issue points at, walking through array elements (`teams.alpha.members.0`). */
function containerAt(record: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  let node: unknown = record
  for (const segment of path) {
    if (Array.isArray(node)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return null
      node = node[index]
    } else if (isRecord(node) && Object.hasOwn(node, segment)) {
      node = node[segment]
    } else {
      return null
    }
  }
  return isRecord(node) ? node : null
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

const validateLayerRecord: PruneValidator = (record) => {
  const parsed = OmoConfigLayerSchema.safeParse(record)
  return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues }
}

/**
 * Validate one parsed config file. Gate order: (1) unsafe own keys and prototype-tampered objects
 * are rebuilt from safe own entries and reported like other unknown keys; (2) schema-unknown keys
 * are stripped with the same `unknown-keys` diagnostic; (3) every remaining invalid value is pruned with its own
 * `invalid-value` diagnostic. A root that is not an object, an issue on the root, an exhausted
 * prune bound, or a file with nothing valid left rejects the file with its validation diagnostic.
 */
export function validateConfigLayer(path: string, data: unknown): OmoConfigLayerValidation {
  const sanitized = sanitizeUnsafeKeys(data)
  const record = toRecord(sanitized.value)
  const unsafeIssuePaths = sanitized.issues.flatMap((issue) => issue.keys.map((key) => [...issue.path, key].join(".")))
  const unsafeDiagnostics: OmoConfigDiagnostic[] = unsafeIssuePaths.length === 0
    ? []
    : [{ kind: "unknown-keys", message: `Ignored unknown keys in ${path}: ${unsafeIssuePaths.join(", ")}`, path, issuePaths: unsafeIssuePaths }]
  const validation = OmoConfigLayerSchema.safeParse(sanitized.value)
  if (validation.success) {
    if (record !== null) return { loaded: true, diagnostics: unsafeDiagnostics, value: record }
    return {
      loaded: false,
      diagnostics: [{ kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path }],
    }
  }

  const rejected = { loaded: false, diagnostics: [validationDiagnostic(path, validation.error.issues)] } as const
  const unknownIssues = unrecognizedKeyIssues(validation.error.issues)
  if (record === null) return rejected

  let candidate = record
  let issues: readonly z.core.$ZodIssue[] = validation.error.issues
  const diagnostics: OmoConfigDiagnostic[] = [...unsafeDiagnostics]
  if (unknownIssues.length > 0) {
    const { issuePaths, stripped } = stripUnrecognizedKeys(record, unknownIssues)
    if (issuePaths.length > 0) {
      diagnostics.push({ kind: "unknown-keys", message: `Ignored unknown keys in ${path}: ${issuePaths.join(", ")}`, path, issuePaths })
    }
    const strippedValidation = validateLayerRecord(stripped)
    if (strippedValidation.success) return { loaded: true, diagnostics, value: stripped }
    candidate = stripped
    issues = strippedValidation.issues
  }

  const pruned = pruneInvalidConfigPaths(candidate, issues, validateLayerRecord)
  if (!pruned.ok) return rejected
  return { loaded: true, diagnostics: [...diagnostics, ...invalidValueDiagnostics(path, pruned.dropped)], value: pruned.config }
}
