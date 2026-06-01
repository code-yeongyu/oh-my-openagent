import type { FallbackModelObject } from "../config/schema/fallback-models"
import type { CopilotSubscription } from "./types"

export interface ProviderAvailability {
	native: {
		claude: boolean
		openai: boolean
		gemini: boolean
	}
	opencodeZen: boolean
	copilot: CopilotSubscription
	zai: boolean
	kimiForCoding: boolean
	opencodeGo: boolean
	bailianCodingPlan: boolean
	minimaxCnCodingPlan: boolean
	minimaxCodingPlan: boolean
	vercelAiGateway: boolean
	isMaxPlan: boolean
}

export interface AgentConfig {
	model: string
	variant?: string
	fallback_models?: FallbackModelObject[]
}

export interface CategoryConfig {
	model: string
	variant?: string
	fallback_models?: FallbackModelObject[]
}

export interface GeneratedOmoConfig {
	$schema: string
	agents?: Record<string, AgentConfig>
	categories?: Record<string, CategoryConfig>
	[key: string]: unknown
}
