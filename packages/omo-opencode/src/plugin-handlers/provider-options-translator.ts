import { deepMerge } from "@oh-my-opencode/utils"

/** OpenCode consumes per-request provider options from the flat `options`
 *  record on the agent entry — NOT from a top-level `providerOptions` key.
 *
 *  This function translates omo's documented `providerOptions` field onto
 *  the `options` key that OpenCode actually reads, then removes the dead
 *  key so nothing downstream is confused by it.
 *
 *  Semantics: the translated keys go flat (e.g. `options.thinking_token_budget`)
 *  and are deep-merged so pre-existing `options` entries are preserved.
 *  Precedence: the user's `providerOptions` values win over any prior content.
 */
export function translateProviderOptions(
  entry: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== "object") return entry
  const providerOptions = (entry as Record<string, unknown>)["providerOptions"]
  if (!providerOptions || typeof providerOptions !== "object") return entry

  const result = { ...entry }
  const existingOptions = result["options"] as Record<string, unknown> | undefined
  result["options"] = deepMerge(existingOptions, providerOptions as Record<string, unknown>)
  delete result["providerOptions"]

  return result
}
