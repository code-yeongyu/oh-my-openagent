import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { homedir } from "os"
import yaml from "js-yaml"
import type { SkillIndex, IndexedSkill, ContextInfo, SkillBundle } from "./types"

const SKILL_CACHE = new Map<string, SkillIndex>()
const SKILL_BUNDLES: Map<string, SkillBundle> = new Map()

const BUILTIN_BUNDLES: SkillBundle[] = [
	{
		name: "webapp",
		skills: ["python-pro", "frontend-developer-skill", "sql-pro", "testing"],
		triggerKeywords: ["web app", "website", "full stack", "fullstack"],
	},
	{
		name: "backend-api",
		skills: ["backend-developer", "api-designer", "database-optimizer"],
		triggerKeywords: ["api", "backend", "rest", "graphql"],
	},
	{
		name: "frontend-only",
		skills: ["react-specialist", "frontend-ui-ux-engineer", "typescript-pro"],
		triggerKeywords: ["react", "vue", "angular", "frontend"],
	},
	{
		name: "migration",
		skills: ["database-optimizer", "legacy-modernizer", "testing"],
		triggerKeywords: ["migration", "migrate", "refactor", "legacy"],
	},
	{
		name: "debugging",
		skills: ["debugger", "error-detective", "code-reviewer"],
		triggerKeywords: ["debug", "bug", "fix", "issue", "error"],
	},
	{
		name: "devops",
		skills: ["devops-engineer", "kubernetes-specialist", "terraform-engineer"],
		triggerKeywords: ["deploy", "ci/cd", "docker", "kubernetes", "k8s"],
	},
	{
		name: "data-science",
		skills: ["python-pro", "data-scientist", "ml-engineer"],
		triggerKeywords: ["ml", "machine learning", "data", "analytics"],
	},
	{
		name: "mobile",
		skills: ["react-native-specialist", "flutter-expert"],
		triggerKeywords: ["mobile", "ios", "android", "app"],
	},
]

const DOMAIN_TO_SKILLS: Record<string, string[]> = {
	python: ["python-pro", "django-developer", "data-scientist", "ml-engineer"],
	typescript: ["typescript-pro", "react-specialist", "nextjs-developer"],
	javascript: ["javascript-pro", "react-specialist", "node-developer"],
	react: ["react-specialist", "frontend-developer-skill", "nextjs-developer"],
	vue: ["vue-expert", "frontend-developer-skill"],
	angular: ["angular-architect", "frontend-developer-skill"],
	postgresql: ["postgres-pro", "database-optimizer", "sql-pro"],
	mysql: ["sql-pro", "database-optimizer"],
	mongodb: ["database-optimizer", "backend-developer"],
	docker: ["devops-engineer", "deployment-engineer"],
	kubernetes: ["kubernetes-specialist", "devops-engineer"],
	terraform: ["terraform-engineer", "cloud-architect"],
	aws: ["cloud-architect", "devops-engineer"],
	rust: ["rust-engineer", "systems-programming"],
	cpp: ["cpp-pro", "systems-programming"],
	go: ["golang-pro", "backend-developer"],
	java: ["java-architect", "spring-boot-engineer"],
	kotlin: ["kotlin-specialist", "android-developer"],
	swift: ["swift-expert", "macos-developer"],
	testing: ["qa-expert", "test-automator", "testing"],
	security: ["security-engineer", "penetration-tester", "compliance-auditor"],
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

function extractDomains(text: string): string[] {
	const domainPatterns = [
		/react|vue|angular|svelte|nextjs|nuxt/gi,
		/node|deno|bun|express|fastify/gi,
		/postgresql|mysql|mongodb|redis|sqlite/gi,
		/docker|kubernetes|terraform|ansible/gi,
		/python|rust|go|typescript|javascript|cpp|c#/gi,
		/api|rest|graphql|websocket/gi,
		/test|debug|refactor|migrate|deploy/gi,
		/auth|oauth|jwt|security/gi,
		/microservice|serverless/gi,
		/ml|machine learning|data|analytics/gi,
	]

	const terms: string[] = []
	for (const pattern of domainPatterns) {
		const matches = text.match(pattern) || []
		terms.push(...matches.map((m) => m.toLowerCase()))
	}

	return [...new Set(terms)]
}

function loadSkillContent(skillPath: string): { name: string; description: string } | null {
	try {
		const content = readFileSync(skillPath, "utf-8")
		const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
		if (!frontmatterMatch) return null

		const parsed = yaml.load(frontmatterMatch[1]) as Record<string, unknown>
		if (parsed && typeof parsed === "object" && "name" in parsed) {
			return {
				name: String(parsed.name),
				description: String(parsed.description || ""),
			}
		}
	} catch {
		return null
	}
	return null
}

export function buildSkillIndex(forceRebuild = false): SkillIndex {
	const cacheKey = "global"
	if (!forceRebuild && SKILL_CACHE.has(cacheKey)) {
		return SKILL_CACHE.get(cacheKey)!
	}

	const skills = new Map<string, IndexedSkill>()
	const keywordIndex = new Map<string, Set<string>>()
	const domainIndex = new Map<string, string[]>()
	const extensionIndex = new Map<string, string[]>()

	const userSkillsDir = join(homedir(), ".config", "opencode", "skill")
	if (!existsSync(userSkillsDir)) {
		const emptyIndex: SkillIndex = {
			skills: new Map(),
			keywords: new Map(),
			domains: new Map(),
			fileExtensions: new Map(),
			builtAt: new Date(),
		}
		SKILL_CACHE.set(cacheKey, emptyIndex)
		return emptyIndex
	}

	try {
		const entries = readdirSync(userSkillsDir, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const skillPath = join(userSkillsDir, entry.name, "skill.yaml")
			const mdPath = join(userSkillsDir, entry.name, "SKILL.md")

			const skillInfo = existsSync(skillPath)
				? loadSkillContent(skillPath)
				: existsSync(mdPath)
				? loadSkillContent(mdPath)
				: null

			if (!skillInfo) continue

			const keywords = extractKeywords(`${skillInfo.name} ${skillInfo.description}`)
			const domains = extractDomains(`${skillInfo.name} ${skillInfo.description}`)

			const skill: IndexedSkill = {
				name: skillInfo.name,
				description: skillInfo.description,
				keywords,
				domains,
				fileExtensions: [],
				aliases: [skillInfo.name.replace(/-/g, " "), `${skillInfo.name}-skill`],
				bundles: [],
			}

			for (const keyword of keywords) {
				if (!keywordIndex.has(keyword)) {
					keywordIndex.set(keyword, new Set())
				}
				keywordIndex.get(keyword)!.add(skillInfo.name)
			}

			for (const domain of domains) {
				if (!domainIndex.has(domain)) {
					domainIndex.set(domain, [])
				}
				domainIndex.get(domain)!.push(skillInfo.name)
			}

			skills.set(skillInfo.name, skill)
		}

		for (const bundle of BUILTIN_BUNDLES) {
			SKILL_BUNDLES.set(bundle.name, bundle)
			for (const skillName of bundle.skills) {
				const skill = skills.get(skillName)
				if (skill) {
					skill.bundles.push(bundle.name)
				}
			}
		}
	} catch {
		console.error("Failed to build skill index")
	}

	const index: SkillIndex = {
		skills,
		keywords: keywordIndex,
		domains: domainIndex,
		fileExtensions: extensionIndex,
		builtAt: new Date(),
	}

	SKILL_CACHE.set(cacheKey, index)
	console.log(`[skill-matcher] Built index with ${skills.size} skills`)

	return index
}

export function getSkillIndex(): SkillIndex {
	return buildSkillIndex(false)
}

export function detectContext(contextDir: string): ContextInfo {
	const extensions = new Set<string>()
	let hasTests = false
	let hasDocker = false
	let hasK8s = false
	let hasDatabase = false

	try {
		const files = walkDir(contextDir)
		for (const file of files) {
			const ext = extname(file).toLowerCase().slice(1)
			if (ext) extensions.add(ext)

			const basename = file.split("/").pop()?.toLowerCase() || ""
			if (basename.includes("test") || basename.includes(".spec.") || basename.includes(".test.")) {
				hasTests = true
			}
			if (basename === "dockerfile" || basename.includes("docker-compose")) {
				hasDocker = true
			}
			if (basename.includes("k8s") || basename.includes("kubernetes") || basename.endsWith(".yaml") || basename.endsWith(".yml")) {
				hasK8s = true
			}
			if (basename.includes("schema") || basename.includes("migration") || basename.includes("db/")) {
				hasDatabase = true
			}
		}
	} catch {}

	let projectType: string | undefined
	if (extensions.has("py")) projectType = "python"
	else if (extensions.has("ts") || extensions.has("tsx")) projectType = "typescript"
	else if (extensions.has("js") || extensions.has("jsx")) projectType = "javascript"
	else if (extensions.has("go")) projectType = "go"
	else if (extensions.has("rs")) projectType = "rust"
	else if (extensions.has("java")) projectType = "java"

	return {
		fileExtensions: extensions,
		projectType,
		hasTests,
		hasDocker,
		hasK8s,
		hasDatabase,
	}
}

function walkDir(dir: string, files: string[] = []): string[] {
	if (!existsSync(dir)) return files

	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = join(dir, entry.name)
			if (entry.isDirectory()) {
				if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== ".git") {
					walkDir(fullPath, files)
				}
			} else {
				files.push(fullPath)
			}
		}
	} catch {
		return files
	}

	return files
}

export function getSkillBundles(): SkillBundle[] {
	return Array.from(SKILL_BUNDLES.values())
}

export function findSkillsByKeyword(keyword: string): string[] {
	const index = getSkillIndex()
	const skills = index.keywords.get(keyword.toLowerCase())
	return skills ? Array.from(skills) : []
}

export function findSkillsByDomain(domain: string): string[] {
	const index = getSkillIndex()
	return index.domains.get(domain.toLowerCase()) || []
}
