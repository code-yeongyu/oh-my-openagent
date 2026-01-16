export interface SkillMatcherConfig {
	enabled: boolean
	threshold: number
	maxSkills: number
	method: "keyword" | "description" | "hybrid" | "llm"
	excludePatterns: string[]
	enableCaching: boolean
	enableContextAwareness: boolean
	enableExplicitMentions: boolean
	enableSkillBundles: boolean
	enableConflictDetection: boolean
	enableLearning: boolean
	llmModel?: string
	llmThreshold: number
}

export interface ScoredSkill {
	name: string
	description: string
	score: number
	matchedKeywords: string[]
	confidence: number
	bundle?: string
	explicitMention?: boolean
}

export interface SkillMatchResult {
	matchedSkills: string[]
	allScores: ScoredSkill[]
	warnings: string[]
	usedBundles: string[]
	explicitMentions: string[]
}

export interface SkillFeedback {
	skillName: string
	useful: number
	useless: number
	lastUsed: Date
}

export interface SkillIndex {
	skills: Map<string, IndexedSkill>
	keywords: Map<string, Set<string>>
	domains: Map<string, string[]>
	fileExtensions: Map<string, string[]>
	builtAt: Date
}

export interface IndexedSkill {
	name: string
	description: string
	keywords: string[]
	domains: string[]
	fileExtensions: string[]
	aliases: string[]
	bundles: string[]
}

export interface SkillBundle {
	name: string
	skills: string[]
	triggerKeywords: string[]
}

export interface ContextInfo {
	fileExtensions: Set<string>
	projectType?: string
	hasTests: boolean
	hasDocker: boolean
	hasK8s: boolean
	hasDatabase: boolean
}
