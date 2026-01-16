import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "os"
import yaml from "js-yaml"
import type {
	SkillMatcherConfig,
	ScoredSkill,
	SkillMatchResult,
	SkillFeedback,
	ContextInfo,
	SkillBundle,
} from "./types"
import {
	buildSkillIndex,
	getSkillIndex,
	detectContext,
	getSkillBundles,
	findSkillsByKeyword,
	findSkillsByDomain,
} from "./indexer"

const FEEDBACK_FILE = join(homedir(), ".config", "opencode", "skill-feedback.json")
const LEARNING_WEIGHTS = {
	keyword: 0.3,
	description: 0.25,
	context: 0.2,
	explicit: 0.15,
	bundle: 0.1,
}

let feedbackCache: Map<string, SkillFeedback> | null = null

function loadFeedback(): Map<string, SkillFeedback> {
	if (feedbackCache) return feedbackCache

	feedbackCache = new Map()
	if (!existsSync(FEEDBACK_FILE)) return feedbackCache

	try {
		const content = readFileSync(FEEDBACK_FILE, "utf-8")
		const data = JSON.parse(content) as Record<string, SkillFeedback>
		for (const [name, feedback] of Object.entries(data)) {
			feedbackCache.set(name, { ...feedback, lastUsed: new Date(feedback.lastUsed) })
		}
	} catch {
		return feedbackCache
	}

	return feedbackCache
}

function saveFeedback(): void {
	if (!feedbackCache) return

	const data: Record<string, SkillFeedback> = {}
	for (const [name, feedback] of feedbackCache) {
		data[name] = feedback
	}

	try {
		mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
		writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2))
	} catch {
		console.error("Failed to save skill feedback")
	}
}

export function recordSkillFeedback(skillName: string, useful: boolean): void {
	const feedback = loadFeedback()
	const current = feedback.get(skillName) || {
		skillName,
		useful: 0,
		useless: 0,
		lastUsed: new Date(),
	}

	if (useful) {
		current.useful++
	} else {
		current.useless++
	}
	current.lastUsed = new Date()

	feedback.set(skillName, current)
	saveFeedback()
}

function getLearningAdjustedScore(skillName: string, baseScore: number): number {
	const feedback = loadFeedback()
	const fb = feedback.get(skillName)

	if (!fb) return baseScore

	const total = fb.useful + fb.useless
	if (total === 0) return baseScore

	const ratio = fb.useful / total
	const adjustment = (ratio - 0.5) * 0.2

	return Math.max(0, Math.min(1, baseScore + adjustment))
}

function extractKeywords(text: string): string[] {
	const normalized = text.toLowerCase()
	const words = normalized
		.replace(/[^\w\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2)

	const bigrams: string[] = []
	for (let i = 0; i < words.length - 1; i++) {
		bigrams.push(`${words[i]}-${words[i + 1]}`)
	}

	return [...new Set([...words, ...bigrams])]
}

function detectExplicitMentions(query: string, skills: Map<string, string>): string[] {
	const mentions: string[] = []
	const queryLower = query.toLowerCase()
	for (const [skillName, description] of skills) {
		const nameLower = skillName.toLowerCase()
		const nameWords = nameLower.replace(/-/g, " ")

		if (
			queryLower.includes(nameLower) ||
			queryLower.includes(nameWords) ||
			queryLower.includes(`${nameLower}-skill`) ||
			queryLower.includes(`the ${nameWords} skill`) ||
			queryLower.includes(`use ${nameWords}`) ||
			queryLower.includes(`need ${nameWords}`) ||
			queryLower.includes(`${nameWords} expertise`)
		) {
			mentions.push(skillName)
		}
	}

	return mentions
}

function calculateKeywordScore(queryKeywords: string[], skillName: string, skillDescription: string): number {
	const skillText = `${skillName} ${skillDescription}`.toLowerCase()
	const skillKeywords = extractKeywords(skillText)

	let exactMatches = 0
	let partialMatches = 0

	for (const qk of queryKeywords) {
		if (skillKeywords.includes(qk)) {
			exactMatches++
		} else if (skillText.includes(qk.replace(/-/g, " "))) {
			partialMatches++
		}
	}

	if (exactMatches === 0 && partialMatches === 0) return 0

	const totalWeight = exactMatches * 2 + partialMatches
	const maxPossible = queryKeywords.length * 2

	return totalWeight / maxPossible
}

function calculateDescriptionScore(query: string, skillDescription: string): number {
	const queryLower = query.toLowerCase()
	const skillDesc = skillDescription.toLowerCase()

	const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3)
	if (queryWords.length === 0) return 0

	let matches = 0
	for (const word of queryWords) {
		if (skillDesc.includes(word)) matches++
	}

	return matches / queryWords.length
}

function calculateContextBoost(context: ContextInfo, skillName: string, skillDescription: string): number {
	let boost = 0
	const text = `${skillName} ${skillDescription}`.toLowerCase()

	if (context.projectType) {
		const domainSkills = findSkillsByDomain(context.projectType)
		if (domainSkills.includes(skillName)) boost += 0.3
	}

	if (context.hasDocker && text.includes("docker")) boost += 0.2
	if (context.hasK8s && text.includes("kubernetes")) boost += 0.2
	if (context.hasDatabase && (text.includes("database") || text.includes("sql"))) boost += 0.2
	if (context.hasTests && (text.includes("test") || text.includes("testing"))) boost += 0.15

	const extensions = Array.from(context.fileExtensions)
	for (const ext of extensions) {
		const extSkills = findSkillsByDomain(ext)
		if (extSkills.includes(skillName)) boost += 0.25
	}

	return Math.min(boost, 0.5)
}

function detectBundles(query: string): { bundles: string[]; skills: string[] } {
	const bundles = getSkillBundles()
	const detectedBundles: string[] = []
	const bundleSkills: string[] = []

	const queryLower = query.toLowerCase()

	for (const bundle of bundles) {
		const hasTrigger = bundle.triggerKeywords.some((kw) => queryLower.includes(kw))
		if (hasTrigger) {
			detectedBundles.push(bundle.name)
			bundleSkills.push(...bundle.skills)
		}
	}

	return { bundles: detectedBundles, skills: [...new Set(bundleSkills)] }
}

function detectConflicts(matchedSkills: string[]): string[] {
	const warnings: string[] = []

	const conflictGroups = [
		["debugger", "error-detective", "error-detector"],
		["frontend-developer-skill", "frontend-ui-ux-engineer"],
		["data-engineer", "data-scientist", "ml-engineer"],
		["devops-engineer", "sre-engineer", "platform-engineer"],
	]

	for (const group of conflictGroups) {
		const overlaps = matchedSkills.filter((s) => group.includes(s))
		if (overlaps.length > 1) {
			warnings.push(`Loaded multiple overlapping skills: ${overlaps.join(", ")}`)
		}
	}

	return warnings
}

async function llmSmartMatch(
	query: string,
	skills: Map<string, string>,
	config: SkillMatcherConfig
): Promise<Map<string, number>> {
	if (config.method !== "llm" || !config.llmModel) {
		return new Map()
	}

	return new Map()
}

export function matchSkills(
	query: string,
	config: SkillMatcherConfig,
	currentSkills: string[] = [],
	contextDir?: string
): SkillMatchResult {
	if (!config.enabled || !query.trim()) {
		return { matchedSkills: [], allScores: [], warnings: [], usedBundles: [], explicitMentions: [] }
	}

	const index = getSkillIndex()
	const context = contextDir ? detectContext(contextDir) : null
	const queryKeywords = extractKeywords(query)

	const explicitMentions = config.enableExplicitMentions
		? detectExplicitMentions(query, new Map(Array.from(index.skills).map(([k, v]) => [k, v.description])))
		: []

	const bundleResult = config.enableSkillBundles ? detectBundles(query) : { bundles: [], skills: [] }

	const scoredSkills: ScoredSkill[] = []
	const skillScores = config.method === "llm" ? new Map<string, number>() : null

	for (const [skillName, skill] of index.skills) {
		if (currentSkills.includes(skillName)) continue
		if (config.excludePatterns.some((pattern) => skillName.includes(pattern))) continue

		let score = 0
		const matchedKeywords: string[] = []

		const keywordScore = calculateKeywordScore(queryKeywords, skillName, skill.description)
		const descScore = calculateDescriptionScore(query, skill.description)
		const contextBoost = context && config.enableContextAwareness ? calculateContextBoost(context, skillName, skill.description) : 0

		const learningAdjustment = config.enableLearning ? getLearningAdjustedScore(skillName, 0) : 0

		switch (config.method) {
			case "keyword":
				score = keywordScore
				break
			case "description":
				score = descScore
				break
			case "hybrid":
				score = keywordScore * 0.6 + descScore * 0.4
				break
			case "llm":
				score = skillScores?.get(skillName) || keywordScore * 0.5 + descScore * 0.3 + contextBoost * 0.2
				break
		}

		if (contextBoost > 0) {
			score += contextBoost * 0.3
		}

		if (learningAdjustment !== 0) {
			score = score * (1 + learningAdjustment * 0.2)
		}

		if (explicitMentions.includes(skillName)) {
			score = Math.min(1, score + 0.5)
		}

		if (bundleResult.skills.includes(skillName)) {
			score = Math.min(1, score + 0.2)
		}

		scoredSkills.push({
			name: skillName,
			description: skill.description,
			score: Math.min(1, score),
			matchedKeywords,
			confidence: Math.min(1, score),
			bundle: bundleResult.bundles.find((b) =>
				getSkillBundles().find((sb) => sb.name === b)?.skills.includes(skillName)
			),
			explicitMention: explicitMentions.includes(skillName),
		})
	}

	scoredSkills.sort((a, b) => b.score - a.score)

	const filtered = scoredSkills.filter((s) => s.score >= config.threshold)
	const topSkills = filtered.slice(0, config.maxSkills)

	const warnings = config.enableConflictDetection ? detectConflicts(topSkills.map((s) => s.name)) : []

	return {
		matchedSkills: topSkills.map((s) => s.name),
		allScores: scoredSkills,
		warnings,
		usedBundles: bundleResult.bundles,
		explicitMentions,
	}
}

export function getDefaultConfig(): SkillMatcherConfig {
	return {
		enabled: true,
		threshold: 0.3,
		maxSkills: 5,
		method: "hybrid",
		excludePatterns: [],
		enableCaching: true,
		enableContextAwareness: true,
		enableExplicitMentions: true,
		enableSkillBundles: true,
		enableConflictDetection: true,
		enableLearning: true,
		llmModel: "google/antigravity-gemini-3-flash",
		llmThreshold: 0.7,
	}
}

export interface ParallelAgentSuggestion {
	shouldSpawn: boolean
	agents: Array<{
		agent: string
		reason: string
		prompt: string
	}>
}

export function suggestParallelAgents(query: string): ParallelAgentSuggestion {
	const suggestions: ParallelAgentSuggestion = {
		shouldSpawn: false,
		agents: [],
	}

	const queryLower = query.toLowerCase()

	const patterns = [
		{
			agent: "explore",
			triggers: ["find", "search", "look for", "where is", "how does", "what is"],
			extract: (q: string) => q.replace(/^(find|search|look for|where is|how does|what is)\s+/i, ""),
		},
		{
			agent: "librarian",
			triggers: ["documentation", "docs", "how to use", "example", "tutorial", "best practice"],
			extract: (q: string) => q.replace(/.*(documentation|docs|how to use|example|tutorial|best practice)\s+(?:for|of|in)\s+/i, ""),
		},
		{
			agent: "oracle",
			triggers: ["why does", "architecture", "design", "trade-off", "security concern"],
			extract: (q: string) => q.replace(/.*(why does|architecture|design|trade-off|security concern)\s+(?:is|does|should)\s+/i, ""),
		},
	]

	for (const pattern of patterns) {
		const hasTrigger = pattern.triggers.some((t) => queryLower.includes(t))
		if (hasTrigger) {
			const extractedQuery = pattern.extract(query)
			if (extractedQuery && extractedQuery !== query) {
				suggestions.agents.push({
					agent: pattern.agent,
					reason: `Detected "${pattern.triggers.find((t) => queryLower.includes(t))}" in query`,
					prompt: extractedQuery,
				})
			}
		}
	}

	const hasMultipleTasks =
		(queryLower.includes(" and ") || queryLower.includes(" also ") || queryLower.includes(" additionally ")) &&
		query.length > 50

	if (suggestions.agents.length > 0 || hasMultipleTasks) {
		suggestions.shouldSpawn = true
	}

	return suggestions
}

export function getFeedbackStats(): Record<string, { useful: number; useless: number; ratio: number }> {
	const feedback = loadFeedback()
	const stats: Record<string, { useful: number; useless: number; ratio: number }> = {}

	for (const [name, fb] of feedback) {
		const total = fb.useful + fb.useless
		stats[name] = {
			useful: fb.useful,
			useless: fb.useless,
			ratio: total > 0 ? fb.useful / total : 0,
		}
	}

	return stats
}
