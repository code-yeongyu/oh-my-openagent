export interface ProviderAvailability {
	native: {
		claude: boolean
		openai: boolean
		gemini: boolean
	}
	opencodeZen: boolean
	copilot: boolean
	zai: boolean
	isMaxPlan: boolean
}

export interface AgentConfig {
	model: string
	variant?: string
}

export interface CategoryConfig {
	model: string
	variant?: string
}

export interface GeneratedMatrixxConfig {
	$schema: string
	agents?: Record<string, AgentConfig>
	categories?: Record<string, CategoryConfig>
	[key: string]: unknown
}
