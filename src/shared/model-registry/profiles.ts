export type ProfileName = "premium" | "balanced" | "economy"

export interface ProfileOverride {
  model: string
  variant?: string
}

export const PROFILE_PRESETS: Record<ProfileName, Record<string, ProfileOverride>> = {
  premium: {},
  balanced: {},
  economy: {
    sisyphus: { model: "claude-sonnet-4-6" },
    oracle: { model: "gemini-3-flash" },
    metis: { model: "gpt-5.4", variant: "medium" },
    momus: { model: "gemini-3.1-pro", variant: "medium" },
    prometheus: { model: "gpt-5.4", variant: "medium" },
    "multimodal-looker": { model: "gemini-3-flash" },
    ultrabrain: { model: "gpt-5.4", variant: "medium" },
    deep: { model: "gpt-5.4" },
  },
}

export const DEFAULT_PROFILE: ProfileName = "balanced"

export function getProfileOverride(
  profileName: ProfileName,
  agentName: string,
): ProfileOverride | undefined {
  const preset = PROFILE_PRESETS[profileName]
  return preset[agentName]
}
