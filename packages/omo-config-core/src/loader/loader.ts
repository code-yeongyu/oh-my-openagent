import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { OmoConfigLayerSchema, OmoConfigSchema, OmoTaskSettingsSchema, type OmoConfig } from "../schema"
import { mergeOmoConfigRecords } from "./merge"
import { resolveOmoConfigPaths } from "./paths"
import {
  DEFAULT_READ_FILE_SYSTEM,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfigDiagnostic,
  type OmoConfigReadFileSystem,
  type OmoConfigSource,
} from "./types"

const DEFAULT_RAW_CONFIG: Record<string, unknown> = {
  agents: {},
  categories: {},
  task: OmoTaskSettingsSchema.parse({}),
  teams: {},
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
  readonly diagnostic?: OmoConfigDiagnostic
  readonly source: OmoConfigSource
  readonly value?: Record<string, unknown>
} {
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

  const validation = OmoConfigLayerSchema.safeParse(parsed.data)
  if (!validation.success) {
    return {
      diagnostic: validationDiagnostic(path, validation.error.issues),
      source: { exists: true, loaded: false, path, scope },
    }
  }
  const parsedRecord = toRecord(parsed.data)
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

export function loadOmoConfig(options: LoadOmoConfigOptions = {}): LoadOmoConfigResult {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM
  const cwd = options.cwd ?? process.cwd()
  let merged = DEFAULT_RAW_CONFIG
  const diagnostics: OmoConfigDiagnostic[] = []
  const sources: OmoConfigSource[] = []

  for (const candidate of resolveOmoConfigPaths({
    cwd,
    env: options.env,
    fileSystem,
    platform: options.platform,
  })) {
    const loaded = readConfigSource(candidate.path, candidate.scope, fileSystem)
    sources.push(loaded.source)
    if (loaded.diagnostic !== undefined) diagnostics.push(loaded.diagnostic)
    if (loaded.value !== undefined) merged = mergeOmoConfigRecords(merged, loaded.value)
  }

  const finalConfig = OmoConfigSchema.safeParse(merged)
  if (finalConfig.success) {
    return { config: finalConfig.data, diagnostics, sources }
  }

  return {
    config: OmoConfigSchema.parse(DEFAULT_RAW_CONFIG) satisfies OmoConfig,
    diagnostics: [...diagnostics, validationDiagnostic("(merged omo config)", finalConfig.error.issues)],
    sources,
  }
}
