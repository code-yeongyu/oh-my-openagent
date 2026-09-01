import type { MigrationSourceDescriptor, MigrationTransform } from "@oh-my-opencode/omo-config-core"

import { discoverLegacyConfigGroups, CONFIG_JSONC_MIGRATION_ID, OPENCODE_CONFIG_MIGRATION_ID } from "./discovery"
import { canonicalPath, discoveryFileSystem, hostPathOperations, pathKey, projectDirectories } from "./discovery-paths"
import { mergeRecords } from "./record-values"
import { transformConfigJsoncSources } from "./transform-config-jsonc"
import { transformOpenCodeSources } from "./transform-opencode"
import { REASONING_UNIFICATION_MIGRATION_ID, transformReasoningUnification } from "./reasoning-unification"
import type { ConfigMigrationDiscoveryOptions, DiscoveredLegacyConfigSource } from "./types"
import type { ConfigMigrationTransformResult, OpenCodeTransformScope } from "./transform-types"

export type LegacyConfigMigrationPlan = {
  readonly id: string
  readonly inspect: (sources: Parameters<MigrationTransform>[0]) => ConfigMigrationTransformResult
  readonly mode?: "merge" | "replace-target"
  readonly sources: readonly MigrationSourceDescriptor[]
  readonly targetPath: string
  readonly transform: MigrationTransform
}

export type CreateLegacyConfigMigrationPlansOptions = ConfigMigrationDiscoveryOptions & {
  readonly backupTimestamp?: string
}

type OpenCodePlanInput = {
  readonly scopes: readonly OpenCodeTransformScope[]
  readonly sources: readonly DiscoveredLegacyConfigSource[]
  readonly targetPath: string
}

function backupTimestamp(value: string | undefined): string {
  return value ?? new Date().toISOString().replace(/[:.]/g, "-")
}

function safeRelativePath(path: string, homeDir: string, options: ConfigMigrationDiscoveryOptions): string {
  const pathOperations = hostPathOperations(options)
  const relative = pathOperations.relative(homeDir, path)
  if (relative !== "" && !relative.startsWith("..") && !pathOperations.isAbsolute(relative)) return relative
  return `external-${encodeURIComponent(path)}`
}

function descriptors(
  sources: readonly DiscoveredLegacyConfigSource[],
  options: ConfigMigrationDiscoveryOptions,
  timestamp: string,
): readonly MigrationSourceDescriptor[] {
  const homeDir = canonicalPath(options.homeDir, options)
  const pathOperations = hostPathOperations(options)
  const userBackupRoot = pathOperations.join(
    homeDir,
    ".omo",
    `migration-backup-${timestamp}-opencode-config`,
  )
  return sources.map((source) => ({
    backupPath: source.projectRoot === undefined
      ? pathOperations.join(userBackupRoot, safeRelativePath(source.path, homeDir, options))
      : pathOperations.join(source.projectRoot, ".omo", `migration-backup-${timestamp}`, pathOperations.basename(source.path)),
    path: source.path,
  }))
}

function openCodeInspection(
  input: OpenCodePlanInput,
  loaded: Parameters<MigrationTransform>[0],
): ConfigMigrationTransformResult {
  return input.scopes.reduce<ConfigMigrationTransformResult>((result, scope) => {
    const next = transformOpenCodeSources({ discovered: input.sources, scope, sources: loaded })
    return {
      diagnostics: [...result.diagnostics, ...next.diagnostics],
      document: mergeRecords(result.document, next.document),
    }
  }, { diagnostics: [], document: {} })
}

function openCodePlan(
  input: OpenCodePlanInput,
  options: ConfigMigrationDiscoveryOptions,
  timestamp: string,
): LegacyConfigMigrationPlan {
  return {
    id: OPENCODE_CONFIG_MIGRATION_ID,
    inspect: (loaded) => openCodeInspection(input, loaded),
    sources: descriptors(input.sources, options, timestamp),
    targetPath: input.targetPath,
    transform: (loaded) => openCodeInspection(input, loaded),
  }
}

function mergeOpenCodeInputs(
  inputs: readonly OpenCodePlanInput[],
  options: ConfigMigrationDiscoveryOptions,
): readonly OpenCodePlanInput[] {
  const byTarget = new Map<string, OpenCodePlanInput>()
  for (const input of inputs) {
    const key = pathKey(input.targetPath, options)
    const existing = byTarget.get(key)
    if (existing === undefined) {
      byTarget.set(key, input)
      continue
    }
    byTarget.set(key, {
      scopes: [...existing.scopes, ...input.scopes],
      sources: [...existing.sources, ...input.sources],
      targetPath: existing.targetPath,
    })
  }
  return [...byTarget.values()]
}

function reasoningPlan(targetPath: string): LegacyConfigMigrationPlan {
  const inspect = (sources: Parameters<MigrationTransform>[0]): ConfigMigrationTransformResult =>
    transformReasoningUnification(sources[0]?.value)
  return {
    id: REASONING_UNIFICATION_MIGRATION_ID,
    inspect,
    mode: "replace-target",
    sources: [],
    targetPath,
    transform: inspect,
  }
}

function existingOmoConfigPath(directory: string, options: ConfigMigrationDiscoveryOptions): string | undefined {
  const fileSystem = discoveryFileSystem(options)
  for (const fileName of ["omo.jsonc", "omo.json"] as const) {
    const path = options.pathOperations.join(directory, fileName)
    if (fileSystem.existsSync(path)) return canonicalPath(path, options)
  }
  return undefined
}

export function createLegacyConfigMigrationPlans(
  options: CreateLegacyConfigMigrationPlansOptions,
): readonly LegacyConfigMigrationPlan[] {
  const timestamp = backupTimestamp(options.backupTimestamp)
  const [openCodeGroup, configJsoncGroup] = discoverLegacyConfigGroups(options)
  const pathOperations = hostPathOperations(options)
  const userTargetPath = pathOperations.join(options.homeDir, ".omo", "omo.jsonc")
  const userSources = openCodeGroup.sources.filter((source) => source.projectRoot === undefined)
  const projectSources = new Map<string, DiscoveredLegacyConfigSource[]>()
  for (const source of openCodeGroup.sources) {
    if (source.projectRoot === undefined) continue
    const sources = projectSources.get(source.projectRoot) ?? []
    sources.push(source)
    projectSources.set(source.projectRoot, sources)
  }
  const userInput: OpenCodePlanInput | undefined = userSources.length === 0
    ? undefined
    : { scopes: [{ kind: "user" }], sources: userSources, targetPath: userTargetPath }
  const projectInputs: OpenCodePlanInput[] = []
  for (const [projectRoot, sources] of projectSources) {
    projectInputs.push({
      scopes: [{ kind: "project", projectRoot }],
      sources,
      targetPath: pathOperations.join(projectRoot, ".omo", "omo.jsonc"),
    })
  }
  const openCodeInputs: OpenCodePlanInput[] = [
    ...(userInput === undefined ? [] : [userInput]),
    ...projectInputs,
  ]
  const plans = mergeOpenCodeInputs(openCodeInputs, options).map((input) => openCodePlan(input, options, timestamp))
  const legacyPlans = configJsoncGroup.id !== CONFIG_JSONC_MIGRATION_ID || configJsoncGroup.sources.length === 0
    ? plans
    : [
      ...plans,
      {
        id: CONFIG_JSONC_MIGRATION_ID,
        inspect: (loaded: Parameters<MigrationTransform>[0]) => transformConfigJsoncSources({ discovered: configJsoncGroup.sources, sources: loaded }),
        sources: descriptors(configJsoncGroup.sources, options, timestamp),
        targetPath: userTargetPath,
        transform: (loaded: Parameters<MigrationTransform>[0]) => transformConfigJsoncSources({ discovered: configJsoncGroup.sources, sources: loaded }),
      },
    ]

  const reasoningTargets = new Map<string, string>()
  const addReasoningTarget = (targetPath: string | undefined): void => {
    if (targetPath === undefined) return
    reasoningTargets.set(pathKey(targetPath, options), targetPath)
  }
  addReasoningTarget(existingOmoConfigPath(options.pathOperations.join(options.homeDir, ".omo"), options))
  for (const projectRoot of projectDirectories(options)) {
    addReasoningTarget(existingOmoConfigPath(options.pathOperations.join(projectRoot, ".omo"), options))
  }
  for (const plan of legacyPlans) addReasoningTarget(plan.targetPath)

  return [...legacyPlans, ...[...reasoningTargets.values()].map(reasoningPlan)]
}
