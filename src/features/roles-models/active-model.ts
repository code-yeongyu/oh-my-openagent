import { getOverride } from "./state"

export type ProviderModel = {
  providerID: string
  modelID: string
}

export function parseProviderModel(input: string): ProviderModel | undefined {
  const slashIdx = input.indexOf("/")
  if (slashIdx <= 0 || slashIdx === input.length - 1) return undefined
  return {
    providerID: input.slice(0, slashIdx),
    modelID: input.slice(slashIdx + 1),
  }
}

/**
 * If the session has an active /pick override for the given role, return it as
 * a {providerID, modelID} pair ready to assign to output.message.model. Returns
 * undefined when there's no override or the override string is malformed.
 */
export function resolveOverrideModel(
  sessionID: string,
  role: string | undefined,
): ProviderModel | undefined {
  if (!role) return undefined
  const override = getOverride(sessionID, role)
  if (!override) return undefined
  return parseProviderModel(override.model)
}
