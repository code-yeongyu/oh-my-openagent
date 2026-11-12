export const PLUGIN_SOURCE_ROOT: string
export function loadRequiredPluginArtifacts(repoRoot: string): string[]
export function importMapTargets(manifestPath: string): string[]
export function pluginRequiredOutputs(requiredArtifacts: readonly string[], importTargets: readonly string[]): string[]
export function generatedOutputRequirements(
  patterns: readonly string[],
  pluginOutputs: readonly string[],
): { label: string; regex: RegExp }[]
export function listPatterns(repoRoot: string): string[]
