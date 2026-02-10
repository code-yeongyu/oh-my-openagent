import type { LaunchInput } from "../types"

export function getConcurrencyKeyFromLaunchInput(input: LaunchInput): string {
  return input.model
    ? `${input.model.providerID}/${input.model.modelID}`
    : input.agent
}
