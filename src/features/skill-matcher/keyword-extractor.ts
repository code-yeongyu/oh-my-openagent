export function extractKeywords(text: string): string[] {
	const normalized = text.toLowerCase()

	const words = normalized
		.replace(/[^\w\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2)

	const bigrams: string[] = []
	for (let i = 0; i < words.length - 1; i++) {
		bigrams.push(`${words[i]}-${words[i + 1]}`)
	}

	const trigrams: string[] = []
	for (let i = 0; i < words.length - 2; i++) {
		trigrams.push(`${words[i]}-${words[i + 1]}-${words[i + 2]}`)
	}

	return [...new Set([...words, ...bigrams, ...trigrams])]
}

export function extractDomainTerms(text: string): string[] {
	const domainPatterns = [
		/react|vue|angular|svelte|nextjs|nuxt/g,
		/node|deno|bun|express|fastify/g,
		/postgresql|mysql|mongodb|redis|sqlite/g,
		/docker|kubernetes|terraform|ansible|gcp|aws|azure/g,
		/python|rust|go|typescript|javascript|cpp|c#/g,
		/api|rest|graphql|websocket|grpc/g,
		/test|debug|refactor|migrate|deploy/g,
		/database|query|index|schema|migration/g,
		/auth|oauth|jwt|security|encryption/g,
		/performance|optimization|cache|cdn/g,
		/microservice|monolith|serverless|faas/g,
	]

	const terms: string[] = []
	for (const pattern of domainPatterns) {
		const matches = text.match(pattern) || []
		terms.push(...matches.map((m) => m.toLowerCase()))
	}

	return [...new Set(terms)]
}
