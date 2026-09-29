import { parseJsoncSafe } from "../internal"
import { harnessBlockKey, OMO_CONFIG_LEGACY_HARNESS_ALIASES } from "../schema"
import { detectUserOmoJsonPath } from "./paths"
import { resolveOmoConfigView } from "./resolution"
import { DEFAULT_READ_FILE_SYSTEM, type OmoConfigDiagnostic, type OmoConfigEnv, type OmoConfigReadFileSystem, type OmoConfigSourceScope } from "./types"

/**
 * `gateway` carries per-person chat credentials and listener scopes, so it is read from the user
 * config only (~/.omo/omo.jsonc or ~/.omo/omo.json): its top level plus the `[native]` block (and
 * the legacy `[senpi]` alias) that the native view folds in. A project `.omo` layer, a profile or
 * another harness block never sets it: the loader drops those placements before validation and
 * reports them as `ignored-keys`, so every reader of the loaded config agrees with `omo gateway`.
 */

const GATEWAY_KEY = "gateway"

const NATIVE_BLOCK_KEYS: ReadonlySet<string> = new Set([
  harnessBlockKey("native"),
  ...Object.entries(OMO_CONFIG_LEGACY_HARNESS_ALIASES)
    .filter(([, target]) => target === "native")
    .map(([legacy]) => harnessBlockKey(legacy)),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHarnessBlockKey(key: string): boolean {
  return key.startsWith("[") && key.endsWith("]")
}

function ignoredGatewayPlacements(document: Record<string, unknown>, scope: OmoConfigSourceScope): readonly (readonly string[])[] {
  const placements: (readonly string[])[] = []
  if (scope === "project" && Object.hasOwn(document, GATEWAY_KEY)) placements.push([GATEWAY_KEY])
  for (const [key, block] of Object.entries(document)) {
    if (!isHarnessBlockKey(key) || !isRecord(block) || !Object.hasOwn(block, GATEWAY_KEY)) continue
    if (scope === "project" || !NATIVE_BLOCK_KEYS.has(key)) placements.push([key, GATEWAY_KEY])
  }
  const profiles = document["profiles"]
  if (isRecord(profiles)) {
    for (const [name, profile] of Object.entries(profiles)) {
      if (!isRecord(profile)) continue
      if (Object.hasOwn(profile, GATEWAY_KEY)) placements.push(["profiles", name, GATEWAY_KEY])
      for (const [key, block] of Object.entries(profile)) {
        if (isHarnessBlockKey(key) && isRecord(block) && Object.hasOwn(block, GATEWAY_KEY)) {
          placements.push(["profiles", name, key, GATEWAY_KEY])
        }
      }
    }
  }
  return placements
}

export function dropIgnoredGatewayPlacements(
  document: unknown,
  scope: OmoConfigSourceScope,
): { readonly document: unknown; readonly ignored: readonly string[] } {
  if (!isRecord(document)) return { document, ignored: [] }
  const placements = ignoredGatewayPlacements(document, scope)
  if (placements.length === 0) return { document, ignored: [] }
  const pruned = structuredClone(document)
  for (const placement of placements) {
    let container: unknown = pruned
    for (const segment of placement.slice(0, -1)) container = isRecord(container) ? container[segment] : undefined
    if (isRecord(container)) delete container[GATEWAY_KEY]
  }
  return { document: pruned, ignored: placements.map((placement) => placement.join(".")) }
}

export function ignoredGatewayDiagnostic(path: string, ignored: readonly string[]): OmoConfigDiagnostic {
  return {
    kind: "ignored-keys",
    message: `Ignored gateway in ${path}: ${ignored.join(", ")}. The gateway section is read only from the user config (~/.omo/omo.jsonc or ~/.omo/omo.json), at its top level or in its [native] block.`,
    path,
    issuePaths: ignored,
  }
}

export type UserGatewaySection =
  | { readonly path: string; readonly present: false }
  | { readonly path: string; readonly present: true; readonly value: unknown }

/**
 * The raw `gateway` section of the user config through the native view, before schema validation,
 * so `omo doctor` can name every invalid field even when the loader rejects the whole user layer.
 * A missing, unreadable or unparseable file reads as absent, like every other optional omo.json read.
 */
export function readUserGatewaySection(
  options: { readonly env?: OmoConfigEnv; readonly fileSystem?: OmoConfigReadFileSystem } = {},
): UserGatewaySection {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM
  const path = detectUserOmoJsonPath(options.env ?? process.env, fileSystem)
  if (!fileSystem.existsSync(path)) return { path, present: false }
  let content: string
  try {
    content = fileSystem.readFileSync(path, "utf-8")
  } catch {
    return { path, present: false }
  }
  const parsed = parseJsoncSafe<unknown>(content)
  if (!isRecord(parsed.data)) return { path, present: false }
  const { config } = resolveOmoConfigView({ config: parsed.data, harness: "native" })
  if (!Object.hasOwn(config, GATEWAY_KEY)) return { path, present: false }
  return { path, present: true, value: config[GATEWAY_KEY] }
}
