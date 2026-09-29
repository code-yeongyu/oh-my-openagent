import {
  canonicalizeLegacyCategoryNames,
  canonicalizeLegacyHarnessBlocks,
  OmoConfigSchema,
  resolveOmoTaskSettings,
  type LegacyCategoryRename,
  type LegacyHarnessRename,
  type OmoConfig,
} from "../schema"
import { readConfigSource, validationDiagnostic } from "./layer-source"
import { mergeOmoConfigRecords } from "./merge"
import { resolveOmoConfigPaths } from "./paths"
import { resolveOmoConfigView, resolveOmoProfileName } from "./resolution"
import {
  DEFAULT_READ_FILE_SYSTEM,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfigDiagnostic,
  type OmoConfigRawLayer,
  type OmoConfigSource,
} from "./types"

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
    if (loaded.diagnostic !== undefined) diagnostics.push(loaded.diagnostic)
    if (loaded.ignored !== undefined) diagnostics.push(loaded.ignored)
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
