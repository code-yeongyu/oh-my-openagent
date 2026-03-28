import { log, normalizeModelID } from "../../shared"

type ClaudeFamily = "opus" | "sonnet" | "haiku"

interface ClaudeModelVersion {
  family: ClaudeFamily
  major: number
  minor: number
}

const VERSION_PATTERN = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i

function isClaudeProvider(providerID: string, modelID: string): boolean {
  if (["anthropic", "google-vertex-anthropic", "opencode"].includes(providerID)) return true
  if (providerID === "github-copilot" && modelID.toLowerCase().includes("claude")) return true
  return false
}

/**
 * Parse a Claude model ID into family + semver-ish version.
 *
 * Handles normalised IDs like `claude-opus-4-6`, `claude-sonnet-4-6-20260301`,
 * and `claude-sonnet-4-20250514`.  A captured "minor" value > 99 is a date
 * suffix and is treated as minor 0 (e.g. `sonnet-4-20250514` → version 4.0).
 */
function parseClaudeModelVersion(modelID: string): ClaudeModelVersion | undefined {
  const normalized = normalizeModelID(modelID).toLowerCase()
  const match = normalized.match(VERSION_PATTERN)
  if (!match) return undefined

  const major = Number(match[2])
  const minorRaw = match[3] ? Number(match[3]) : 0
  // Date suffixes like 20250514 are not minor versions — treat as x.0
  const minor = minorRaw > 99 ? 0 : minorRaw

  if (!Number.isFinite(major) || !Number.isFinite(minor)) return undefined

  return { family: match[1].toLowerCase() as ClaudeFamily, major, minor }
}

/**
 * Determine the correct effort level for a Claude model when variant is "max".
 *
 * Returns undefined when the model does not support the effort parameter at all
 * (Haiku, Sonnet 4.0, non-Claude), signalling that the hook should bail out.
 *
 * Supported models (per Anthropic docs):
 *  - Opus 4.6+  → effort "max"
 *  - Opus 4.5   → effort "high" (max is Opus 4.6-exclusive)
 *  - Sonnet 4.6+ (minor > 0) → effort "high"
 *  - Haiku (any) → NOT supported
 *  - Sonnet 4.0  → NOT supported
 */
function resolveEffortForVariantMax(
  modelID: string,
): { effort: "max" | "high"; variant: "max" | "high" } | undefined {
  const parsed = parseClaudeModelVersion(modelID)
  if (!parsed) return undefined

  const aboveMajor4 = parsed.major > 4

  if (parsed.family === "opus") {
    const supportsMax = aboveMajor4 || (parsed.major === 4 && parsed.minor >= 6)
    return supportsMax
      ? { effort: "max", variant: "max" }
      : { effort: "high", variant: "high" }
  }

  if (parsed.family === "sonnet") {
    const supportsEffort = aboveMajor4 || (parsed.major === 4 && parsed.minor > 0)
    return supportsEffort ? { effort: "high", variant: "high" } : undefined
  }

  // Haiku and anything else — effort not supported
  return undefined
}

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

export function createAnthropicEffortHook() {
  return {
    "chat.params": async (
      input: ChatParamsInput,
      output: ChatParamsOutput,
    ): Promise<void> => {
      const { model, message } = input
      if (!model?.modelID || !model?.providerID) return
      if (message.variant !== "max") return
      if (!isClaudeProvider(model.providerID, model.modelID)) return
      if (output.options.effort !== undefined) return

      const resolved = resolveEffortForVariantMax(model.modelID)
      if (!resolved) return

      output.options.effort = resolved.effort

      if (resolved.variant !== "max") {
        ;(message as { variant?: string }).variant = resolved.variant
        log("anthropic-effort: clamped variant max→" + resolved.variant + " for non-Opus-4.6+ model", {
          sessionID: input.sessionID,
          provider: model.providerID,
          model: model.modelID,
        })
      } else {
        log("anthropic-effort: injected effort=max", {
          sessionID: input.sessionID,
          provider: model.providerID,
          model: model.modelID,
        })
      }
    },
  }
}
