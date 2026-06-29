import { execFile } from "node:child_process"
import { isPlainRecord } from "./codex-cache-fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type CodexReasoningProfile = {
  readonly model: string
  readonly modelContextWindow: number
  readonly modelReasoningEffort: string
  readonly planModeReasoningEffort: string
}

export type CodexReasoningProfileMatch = Partial<CodexReasoningProfile>

export type CodexModelCatalog = {
  readonly current: CodexReasoningProfile
  readonly managedProfiles: readonly CodexReasoningProfileMatch[]
}

export type CodexModelInventory = {
  readonly availableModels: ReadonlySet<string>
}

export type CodexModelInventoryResult =
  | { readonly kind: "available"; readonly inventory: CodexModelInventory }
  | { readonly kind: "unavailable"; readonly warning: string }

export type CodexModelCatalogOptions = {
  readonly inventory?: CodexModelInventory
}

export type CodexModelInventoryOptions = {
  readonly codexHome: string
  readonly cwd: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly command?: () => Promise<string>
}

const FALLBACK_CODEX_MODEL_CATALOG: CodexModelCatalog = {
  current: {
    model: "gpt-5.5",
    modelContextWindow: 400_000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh",
  },
  managedProfiles: [
    {
      model: "gpt-5.5",
      modelContextWindow: 1_000_000,
      modelReasoningEffort: "high",
      planModeReasoningEffort: "xhigh",
    },
    { model: "gpt-5.5", modelContextWindow: 272_000 },
  ],
}

const CODEX_REASONING_MODEL_CHAIN: readonly CodexReasoningProfile[] = [
  FALLBACK_CODEX_MODEL_CATALOG.current,
  {
    model: "gpt-5-codex",
    modelContextWindow: 400_000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh",
  },
  {
    model: "gpt-5",
    modelContextWindow: 272_000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh",
  },
]

export function createCodexModelInventory(models: readonly string[]): CodexModelInventory {
  return { availableModels: new Set(models) }
}

export async function resolveCodexInstallModelInventory(input: CodexModelInventoryOptions): Promise<CodexModelInventoryResult> {
  try {
    const output = await (input.command ?? (() => runCodexDebugModels(input)))()
    const inventory = createCodexModelInventory(parseCodexModelInventory(output))
    if (inventory.availableModels.size === 0) {
      return { kind: "unavailable", warning: "Codex model inventory returned no models; using static model catalog." }
    }
    return { kind: "available", inventory }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: "unavailable", warning: `Codex model inventory unavailable (${error.message}); using static model catalog.` }
    }
    throw error
  }
}

export async function readCodexModelCatalog(codexPackageRoot: string, options: CodexModelCatalogOptions = {}): Promise<CodexModelCatalog> {
  const catalogPath = join(codexPackageRoot, "plugin", "model-catalog.json")
  try {
    const parsed: unknown = JSON.parse(await readFile(catalogPath, "utf8"))
    return applyCodexModelInventory(parseCodexModelCatalog(parsed) ?? FALLBACK_CODEX_MODEL_CATALOG, options.inventory)
  } catch (error) {
    if (error instanceof Error) return applyCodexModelInventory(FALLBACK_CODEX_MODEL_CATALOG, options.inventory)
    throw error
  }
}

export async function readCodexReasoningProfile(codexPackageRoot: string): Promise<CodexReasoningProfile> {
  return (await readCodexModelCatalog(codexPackageRoot)).current
}

function parseCodexModelCatalog(value: unknown): CodexModelCatalog | null {
  if (!isPlainRecord(value)) return null
  const current = value["current"]
  const managedProfiles = value["managedProfiles"]
  if (!isPlainRecord(current) || !Array.isArray(managedProfiles)) return null
  const model = current["model"]
  const modelContextWindow = current["model_context_window"]
  const modelReasoningEffort = current["model_reasoning_effort"]
  const planModeReasoningEffort = current["plan_mode_reasoning_effort"]
  if (
    typeof model !== "string" ||
    typeof modelContextWindow !== "number" ||
    typeof modelReasoningEffort !== "string" ||
    typeof planModeReasoningEffort !== "string"
  ) {
    return null
  }
  const parsedManagedProfiles: CodexReasoningProfileMatch[] = []
  for (const profile of managedProfiles) {
    if (!isPlainRecord(profile)) return null
    const match = profile["match"]
    if (!isPlainRecord(match)) return null
    parsedManagedProfiles.push(parseProfileMatch(match))
  }
  return {
    current: { model, modelContextWindow, modelReasoningEffort, planModeReasoningEffort },
    managedProfiles: parsedManagedProfiles,
  }
}

function applyCodexModelInventory(catalog: CodexModelCatalog, inventory: CodexModelInventory | undefined): CodexModelCatalog {
  if (inventory === undefined || inventory.availableModels.has(catalog.current.model)) return catalog
  const selected = CODEX_REASONING_MODEL_CHAIN.find((profile) => inventory.availableModels.has(profile.model))
  if (selected === undefined) return catalog
  return { ...catalog, current: selected }
}

async function runCodexDebugModels(input: CodexModelInventoryOptions): Promise<string> {
  const result = await execFileAsync("codex", ["debug", "models"], {
    cwd: input.cwd,
    encoding: "utf8",
    env: { ...process.env, ...input.env, CODEX_HOME: input.codexHome },
    windowsHide: true,
  })
  return result.stdout
}

function parseCodexModelInventory(output: string): readonly string[] {
  const parsed: unknown = JSON.parse(output)
  const models = new Set<string>()
  collectCodexModelNames(parsed, models)
  return [...models]
}

function collectCodexModelNames(value: unknown, models: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCodexModelNames(item, models)
    return
  }
  if (!isPlainRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (isCodexModelName(key)) models.add(key)
    if ((key === "id" || key === "model" || key === "name" || key === "slug") && typeof nested === "string" && isCodexModelName(nested)) {
      models.add(nested)
    }
    collectCodexModelNames(nested, models)
  }
}

function isCodexModelName(value: string): boolean {
  return /^(?:gpt-|o\d)/.test(value)
}

function parseProfileMatch(match: Record<string, unknown>): CodexReasoningProfileMatch {
  const profile: {
    model?: string
    modelContextWindow?: number
    modelReasoningEffort?: string
    planModeReasoningEffort?: string
  } = {}
  if (typeof match["model"] === "string") profile.model = match["model"]
  if (typeof match["model_context_window"] === "number") profile.modelContextWindow = match["model_context_window"]
  if (typeof match["model_reasoning_effort"] === "string") profile.modelReasoningEffort = match["model_reasoning_effort"]
  if (typeof match["plan_mode_reasoning_effort"] === "string") profile.planModeReasoningEffort = match["plan_mode_reasoning_effort"]
  return profile
}
