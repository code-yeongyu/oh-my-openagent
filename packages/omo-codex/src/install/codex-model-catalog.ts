import { isPlainRecord } from "./codex-cache-fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

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

export async function readCodexModelCatalog(codexPackageRoot: string): Promise<CodexModelCatalog> {
  const catalogPath = join(codexPackageRoot, "plugin", "model-catalog.json")
  try {
    const parsed: unknown = JSON.parse(await readFile(catalogPath, "utf8"))
    return parseCodexModelCatalog(parsed) ?? FALLBACK_CODEX_MODEL_CATALOG
  } catch (error) {
    if (error instanceof Error) return FALLBACK_CODEX_MODEL_CATALOG
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
