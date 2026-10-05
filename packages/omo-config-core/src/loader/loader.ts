import { parse, printParseErrorCode } from "jsonc-parser/lib/esm/main.js"

import {
  canonicalizeLegacyCategoryNames,
  canonicalizeLegacyHarnessBlocks,
  OmoConfigSchema,
  resolveOmoTaskSettings,
  type LegacyCategoryRename,
  type LegacyHarnessRename,
  type OmoConfig,
} from "../schema"
import { invalidValueDiagnostics, validateConfigLayer, validationDiagnostic } from "./layer-validation"
import { mergeOmoConfigRecords } from "./merge"
import { resolveOmoConfigPaths } from "./paths"
import { pruneInvalidConfigPaths } from "./prune-invalid-leaves"
import { resolveOmoConfigView, resolveOmoProfileName } from "./resolution"
import {
  DEFAULT_READ_FILE_SYSTEM,
  MERGED_OMO_CONFIG_PATH,
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
    "[native]": _native,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config
  return resolved
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

  const layer = validateConfigLayer(path, parsed.data)
  return layer.loaded
    ? { diagnostics: layer.diagnostics, source: { exists: true, loaded: true, path, scope }, value: layer.value }
    : { diagnostics: layer.diagnostics, source: { exists: true, loaded: false, path, scope } }
}

function legacyCategoryDiagnostic(path: string, renames: readonly LegacyCategoryRename[]): OmoConfigDiagnostic {
  const detail = renames
    .map((rename) => rename.dropped
      ? `${rename.path} ignored because ${rename.canonical} is also configured`
      : `${rename.path} renamed to ${rename.canonical}`)
    .join(", ")
  return {
    kind: "deprecated-keys",
    message: `Deprecated category name in ${path}: ${detail}. Rename it; the alias is removed in a future release.`,
    path,
    issuePaths: renames.map((rename) => rename.path),
  }
}

function legacyHarnessDiagnostic(path: string, renames: readonly LegacyHarnessRename[]): OmoConfigDiagnostic {
  const detail = renames
    .map((rename) => rename.dropped
      ? `${rename.path} ignored because ${rename.canonical} is also configured`
      : `${rename.path} renamed to ${rename.canonical}`)
    .join(", ")
  return {
    kind: "deprecated-keys",
    message: `Deprecated harness block in ${path}: ${detail}. Rename it; the alias is removed in a future release.`,
    path,
    issuePaths: renames.map((rename) => rename.path),
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
      // A retired category key or harness block still resolves, so a config the startup migration
      // could not rewrite (locked run, read-only project file) keeps applying its override instead
      // of being ignored.
      const canonicalized = canonicalizeLegacyCategoryNames(loaded.value)
      if (canonicalized.renames.length > 0) {
        diagnostics.push(legacyCategoryDiagnostic(candidate.path, canonicalized.renames))
      }
      const harnessCanonicalized = canonicalizeLegacyHarnessBlocks(canonicalized.document)
      if (harnessCanonicalized.renames.length > 0) {
        diagnostics.push(legacyHarnessDiagnostic(candidate.path, harnessCanonicalized.renames))
      }
      layers.push({ config: harnessCanonicalized.document, source: loaded.source })
      merged = mergeOmoConfigRecords(merged, harnessCanonicalized.document)
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
  const finalInput = mergeOmoConfigRecords(DEFAULT_RAW_CONFIG, resolved.config)
  const finalConfig = OmoConfigSchema.safeParse(finalInput)
  if (finalConfig.success) {
    return {
      config: stripResolutionControlKeys(finalConfig.data),
      diagnostics: [...diagnostics, ...resolved.diagnostics],
      layers,
      ...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
      sources,
    }
  }

  // Every layer already validated on its own; a merged value that still fails the full schema (a
  // partial team spec, say) is dropped like any other invalid value instead of resetting the config.
  const pruned = pruneInvalidConfigPaths(finalInput, finalConfig.error.issues, (record) => {
    const parsed = OmoConfigSchema.safeParse(record)
    return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues }
  })
  if (pruned.ok) {
    return {
      config: stripResolutionControlKeys(OmoConfigSchema.parse(pruned.config)),
      diagnostics: [...diagnostics, ...resolved.diagnostics, ...invalidValueDiagnostics(MERGED_OMO_CONFIG_PATH, pruned.dropped)],
      layers,
      ...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
      sources,
    }
  }

  return {
    config: stripResolutionControlKeys(OmoConfigSchema.parse(DEFAULT_RAW_CONFIG)) satisfies OmoConfig,
    diagnostics: [...diagnostics, ...resolved.diagnostics, validationDiagnostic(MERGED_OMO_CONFIG_PATH, finalConfig.error.issues)],
    layers,
    ...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
    sources,
  }
}
