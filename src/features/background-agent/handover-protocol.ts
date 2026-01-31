export interface HandoverSection {
	title: string
	content: string
	items?: string[]
}

export interface HandoverResult {
	summary: string
	discoveries: string[]
	questions: string[]
	suggestions: string[]
	raw: string
	isStructured: boolean
}

const SECTION_HEADERS = {
	summary: ["summary", "总结"],
	discoveries: ["discoveries", "发现"],
	questions: ["questions", "问题"],
	suggestions: ["suggestions", "建议"],
}

export function parseHandover(text: string): HandoverResult {
	const raw = text
	const trimmed = text.trim()

	if (!trimmed) {
		return {
			summary: "No summary provided",
			discoveries: [],
			questions: [],
			suggestions: [],
			raw,
			isStructured: false,
		}
	}

	const isStructured = /^##\s+/m.test(trimmed)

	if (!isStructured) {
		const firstParagraph = trimmed.split(/\n\n/)[0]?.trim() || "No summary provided"
		return {
			summary: firstParagraph,
			discoveries: [],
			questions: [],
			suggestions: [],
			raw,
			isStructured: false,
		}
	}

	const summary = extractSectionContent(trimmed, SECTION_HEADERS.summary) || "No summary provided"
	const discoveries = extractListItems(trimmed, SECTION_HEADERS.discoveries)
	const questions = extractListItems(trimmed, SECTION_HEADERS.questions)
	const suggestions = extractListItems(trimmed, SECTION_HEADERS.suggestions)

	return {
		summary,
		discoveries,
		questions,
		suggestions,
		raw,
		isStructured: true,
	}
}

export function formatHandover(result: HandoverResult): string {
	const sections: string[] = []

	sections.push("## Summary")
	sections.push(result.summary)
	sections.push("")

	sections.push("## Discoveries")
	if (result.discoveries.length > 0) {
		result.discoveries.forEach((item) => sections.push(`- ${item}`))
	}
	sections.push("")

	sections.push("## Questions")
	if (result.questions.length > 0) {
		result.questions.forEach((item) => sections.push(`- ${item}`))
	}
	sections.push("")

	sections.push("## Suggestions")
	if (result.suggestions.length > 0) {
		result.suggestions.forEach((item) => sections.push(`- ${item}`))
	}

	return sections.join("\n")
}

export function extractSection(text: string, sectionName: string): string | null {
	const pattern = new RegExp(`^##\\s+${escapeRegex(sectionName)}\\s*$`, "im")
	const match = text.match(pattern)

	if (!match || match.index === undefined) {
		return null
	}

	const startIndex = match.index + match[0].length
	const nextHeaderPattern = /^##\s+/m
	const remainingText = text.slice(startIndex)
	const nextHeaderMatch = remainingText.match(nextHeaderPattern)

	const endIndex = nextHeaderMatch?.index !== undefined ? startIndex + nextHeaderMatch.index : text.length

	return text.slice(startIndex, endIndex).trim()
}

function extractSectionContent(text: string, headers: string[]): string | null {
	for (const header of headers) {
		const content = extractSection(text, header)
		if (content !== null) {
			const lines = content.split("\n").filter((line) => {
				const trimmed = line.trim()
				return trimmed && !trimmed.match(/^[-*+]\s+/)
			})
			return lines.join("\n").trim() || null
		}
	}
	return null
}

function extractListItems(text: string, headers: string[]): string[] {
	for (const header of headers) {
		const content = extractSection(text, header)
		if (content !== null) {
			const items: string[] = []
			const lines = content.split("\n")
			for (const line of lines) {
				const trimmed = line.trim()
				const match = trimmed.match(/^[-*+]\s+(.+)$/)
				if (match) {
					items.push(match[1].trim())
				}
			}
			return items
		}
	}
	return []
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
