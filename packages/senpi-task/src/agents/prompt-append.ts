import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

type PromptAppendRoots = {
  readonly projectDir: string
  readonly homeDir: string
}

export type PromptAppendFailureReason = "malformed_uri" | "path_rejected" | "missing_file" | "unreadable_file"

export type PromptAppendResolution =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: PromptAppendFailureReason; readonly targetPath?: string }

/**
 * Resolves an `agents.<name>.prompt_append` value the way the OpenCode edition's `mergeAgentConfig`
 * resolves an agent override: a `file://` URI is read from disk (with `~` expansion and paths
 * relative to the project directory), and any other value is literal text. A `file://` failure comes
 * back as a reason instead of throwing or standing in as the append text, so the caller can report a
 * config diagnostic and spawn the agent with its unmodified base persona.
 */
export function resolvePromptAppend(value: string, roots: PromptAppendRoots): PromptAppendResolution {
  if (!value.startsWith("file://")) return { ok: true, value }

  const encoded = value.slice(7)

  let filePath: string
  try {
    const decoded = decodeURIComponent(encoded)
    const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${roots.homeDir}/`) : decoded
    filePath = isAbsolute(expanded) ? expanded : resolve(roots.projectDir, expanded)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { ok: false, reason: "malformed_uri" }
  }

  if (!isWithinAllowedPaths(filePath, roots)) {
    return { ok: false, reason: "path_rejected", targetPath: filePath }
  }

  if (!existsSync(filePath)) {
    return { ok: false, reason: "missing_file", targetPath: filePath }
  }

  try {
    return { ok: true, value: readFileSync(filePath, "utf8") }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { ok: false, reason: "unreadable_file", targetPath: filePath }
  }
}

export function describePromptAppendFailure(
  reason: PromptAppendFailureReason,
  targetPath?: string,
): string {
  const at = targetPath === undefined ? "" : `: ${targetPath}`
  switch (reason) {
    case "malformed_uri":
      return "malformed file URI (invalid percent-encoding)"
    case "path_rejected":
      return `resolved outside the allowed roots (project directory, ~/.omo, ~/.senpi)${at}`
    case "missing_file":
      return `file does not exist${at}`
    case "unreadable_file":
      return `file could not be read${at}`
  }
}

export function promptAppendFailureMessage(
  agent: string,
  value: string,
  reason: PromptAppendFailureReason,
  targetPath?: string,
): string {
  return `agents.${agent}.prompt_append could not be resolved (${describePromptAppendFailure(reason, targetPath)}): ${value}`
}

type PromptAppendConfigLayer = {
  readonly config: Readonly<Record<string, unknown>>
  readonly source: { readonly path: string; readonly loaded: boolean }
}

/** The omo config file that carries the offending value, for a diagnostic's `path`. */
export function findPromptAppendConfigPath(
  layers: readonly PromptAppendConfigLayer[],
  agent: string,
  value: string,
  fallbackPath: string,
): string {
  for (const layer of layers) {
    const definition = readAgentDefinition(layer.config, agent)
    if (definition?.prompt_append === value) return layer.source.path
  }
  return layers.find((layer) => layer.source.loaded)?.source.path ?? fallbackPath
}

function readAgentDefinition(
  config: Readonly<Record<string, unknown>>,
  agent: string,
): Readonly<Record<string, unknown>> | undefined {
  const agents = config["agents"]
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) return undefined
  const definition = (agents as Record<string, unknown>)[agent]
  return typeof definition === "object" && definition !== null && !Array.isArray(definition)
    ? (definition as Readonly<Record<string, unknown>>)
    : undefined
}

function isWithinAllowedPaths(filePath: string, roots: PromptAppendRoots): boolean {
  return (
    isWithin(roots.projectDir, filePath)
    || isWithin(join(roots.homeDir, ".omo"), filePath)
    || isWithin(join(roots.homeDir, ".senpi"), filePath)
  )
}

function isWithin(directory: string, target: string): boolean {
  const nested = relative(resolve(directory), resolve(target))
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))
}
