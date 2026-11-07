export const LANGUAGES = ["typescript", "python", "go", "rust", "java", "kotlin", "csharp", "swift", "c", "ruby", "php"] as const
export type Language = (typeof LANGUAGES)[number]

export interface Definition {
	readonly name: string
	readonly line: number
}

const EXTENSIONS: ReadonlyMap<string, Language> = new Map<string, Language>([
	["ts", "typescript"], ["tsx", "typescript"], ["mts", "typescript"], ["cts", "typescript"], ["js", "typescript"], ["jsx", "typescript"], ["mjs", "typescript"], ["cjs", "typescript"],
	["py", "python"], ["go", "go"], ["rs", "rust"], ["java", "java"], ["kt", "kotlin"], ["kts", "kotlin"], ["cs", "csharp"], ["swift", "swift"],
	["c", "c"], ["h", "c"], ["cc", "c"], ["cpp", "c"], ["cxx", "c"], ["hpp", "c"], ["hh", "c"], ["rb", "ruby"], ["php", "php"],
])

export function languageFor(path: string): Language | null {
	const dot = path.lastIndexOf(".")
	if (dot < 0) return null
	return EXTENSIONS.get(path.slice(dot + 1).toLowerCase()) ?? null
}

const IDENT = "([A-Za-z_$][A-Za-z0-9_$]*)"
const DEFINITION_PATTERNS: Readonly<Record<Language, readonly RegExp[]>> = {
	typescript: [
		new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${IDENT}`),
		new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+${IDENT}`),
		new RegExp(`^(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${IDENT}`),
		new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum|namespace)\\s+${IDENT}`),
		new RegExp(`^(?:\\t| {2,})(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|override\\s+)*(?:async\\s+)?(?:get\\s+|set\\s+)?${IDENT}\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^{]*)?\\{\\s*$`),
	],
	python: [new RegExp(`^\\s*(?:async\\s+)?def\\s+${IDENT}`), new RegExp(`^\\s*class\\s+${IDENT}`)],
	go: [new RegExp(`^func\\s+(?:\\([^)]*\\)\\s*)?${IDENT}`), new RegExp(`^type\\s+${IDENT}`), new RegExp(`^(?:var|const)\\s+${IDENT}`)],
	rust: [new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:fn|struct|enum|trait|type|mod|const|static|union)\\s+${IDENT}`)],
	java: [new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|abstract\\s+)*(?:class|interface|enum|record)\\s+${IDENT}`), new RegExp(`^\\s+(?:public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|synchronized\\s+)*[A-Za-z_<>\\[\\],. ]+\\s+${IDENT}\\s*\\([^)]*\\)\\s*(?:throws[^{]*)?\\{`)],
	kotlin: [new RegExp(`^\\s*(?:public\\s+|private\\s+|internal\\s+|open\\s+|data\\s+|sealed\\s+|abstract\\s+)*(?:class|interface|object|enum class)\\s+${IDENT}`), new RegExp(`^\\s*(?:public\\s+|private\\s+|internal\\s+|override\\s+|suspend\\s+|inline\\s+)*fun\\s+(?:<[^>]*>\\s*)?(?:[A-Za-z_.]+\\.)?${IDENT}`)],
	csharp: [new RegExp(`^\\s*(?:public\\s+|private\\s+|internal\\s+|protected\\s+|static\\s+|sealed\\s+|abstract\\s+|partial\\s+)*(?:class|interface|struct|enum|record)\\s+${IDENT}`), new RegExp(`^\\s+(?:public\\s+|private\\s+|internal\\s+|protected\\s+|static\\s+|virtual\\s+|override\\s+|async\\s+)+[A-Za-z_<>\\[\\],.? ]+\\s+${IDENT}\\s*\\([^)]*\\)\\s*\\{?\\s*$`)],
	swift: [new RegExp(`^\\s*(?:public\\s+|private\\s+|internal\\s+|open\\s+|final\\s+)*(?:class|struct|enum|protocol|actor|extension)\\s+${IDENT}`), new RegExp(`^\\s*(?:public\\s+|private\\s+|internal\\s+|open\\s+|static\\s+|override\\s+)*func\\s+${IDENT}`)],
	c: [new RegExp(`^\\s*(?:typedef\\s+)?(?:struct|union|enum|class)\\s+${IDENT}`), new RegExp(`^[A-Za-z_][A-Za-z0-9_*\\s<>:,]*?\\b${IDENT}\\s*\\([^;]*\\)\\s*(?:const\\s*)?\\{?\\s*$`)],
	ruby: [new RegExp(`^\\s*def\\s+(?:self\\.)?${IDENT}`), new RegExp(`^\\s*(?:class|module)\\s+${IDENT}`)],
	php: [new RegExp(`^\\s*(?:abstract\\s+|final\\s+)?(?:class|interface|trait|enum)\\s+${IDENT}`), new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+)*function\\s+${IDENT}`)],
}

const C_CONTROL: ReadonlySet<string> = new Set(["if", "else", "for", "while", "switch", "return", "sizeof", "do", "case"])

const KEYWORDS: ReadonlySet<string> = new Set([
	"abstract", "and", "as", "assert", "async", "await", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "constructor", "continue",
	"debugger", "def", "default", "del", "delete", "do", "double", "elif", "else", "end", "enum", "except", "export", "extends", "false", "final", "finally",
	"float", "fn", "for", "from", "func", "function", "get", "global", "go", "if", "impl", "implements", "import", "in", "instanceof", "int", "interface",
	"is", "lambda", "let", "long", "match", "mod", "module", "mut", "namespace", "new", "nil", "none", "not", "null", "of", "or", "override", "package",
	"pass", "private", "protected", "pub", "public", "raise", "readonly", "record", "ref", "require", "return", "self", "set", "short", "static", "struct",
	"super", "switch", "this", "throw", "throws", "trait", "true", "try", "type", "typeof", "undefined", "union", "unsafe", "use", "var", "void", "where",
	"while", "with", "yield", "console", "log", "string", "number", "any", "unknown", "never", "object", "println", "print", "fun", "val", "when", "var",
])

export function stripCommentsAndStrings(source: string, language: Language): string {
	const blank = (match: string): string => match.replace(/[^\n]/g, " ")
	let text = source
	if (language === "python") text = text.replace(/("""|''')[\s\S]*?\1/g, blank).replace(/#[^\n]*/g, blank)
	else if (language === "ruby") text = text.replace(/#[^\n]*/g, blank)
	else text = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => prefix + blank(match.slice(prefix.length)))
	if (language === "php") text = text.replace(/#[^\n]*/g, blank)
	return text.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, blank)
}

export function extractDefinitions(source: string, language: Language): Definition[] {
	const definitions: Definition[] = []
	const stripped = stripCommentsAndStrings(source, language)
	stripped.split("\n").forEach((line, index) => {
		for (const pattern of DEFINITION_PATTERNS[language]) {
			const match = pattern.exec(line)
			const name = match?.[1]
			if (name === undefined || KEYWORDS.has(name) || (language === "c" && C_CONTROL.has(name))) continue
			if (!definitions.some((definition) => definition.line === index + 1)) definitions.push({ name, line: index + 1 })
			break
		}
	})
	return definitions
}

export function extractIdentifiers(source: string, language: Language): Map<string, number> {
	const counts = new Map<string, number>()
	const stripped = stripCommentsAndStrings(source, language)
	for (const match of stripped.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
		const name = match[0]
		if (KEYWORDS.has(name) || name.length < 2) continue
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	return counts
}
