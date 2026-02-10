import { ALLOWED_AGENTS } from "./constants"
import type { AllowedAgentType } from "./types"

export function normalizeAgentType(input: string): AllowedAgentType | null {
	const lowered = input.toLowerCase()
	for (const allowed of ALLOWED_AGENTS) {
		if (allowed.toLowerCase() === lowered) {
			return allowed
		}
	}
	return null
}
