// CLI supported languages (25 total)
export const CLI_LANGUAGES = [
	"bash",
	"c",
	"cpp",
	"csharp",
	"css",
	"elixir",
	"go",
	"haskell",
	"html",
	"java",
	"javascript",
	"json",
	"kotlin",
	"lua",
	"nix",
	"php",
	"python",
	"ruby",
	"rust",
	"scala",
	"solidity",
	"swift",
	"typescript",
	"tsx",
	"yaml",
] as const

// NAPI supported languages (5 total - native bindings)
export const NAPI_LANGUAGES = ["html", "javascript", "tsx", "css", "typescript"] as const

export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024
export const DEFAULT_MAX_MATCHES = 500

export const LANG_EXTENSIONS: Record<string, string[]> = {
	bash: [".bash", ".sh", ".zsh", ".bats"],
	c: [".c", ".h"],
	cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"],
	csharp: [".cs"],
	css: [".css"],
	elixir: [".ex", ".exs"],
	go: [".go"],
	haskell: [".hs", ".lhs"],
	html: [".html", ".htm"],
	java: [".java"],
	javascript: [".js", ".jsx", ".mjs", ".cjs"],
	json: [".json"],
	kotlin: [".kt", ".kts"],
	lua: [".lua"],
	nix: [".nix"],
	php: [".php"],
	python: [".py", ".pyi"],
	ruby: [".rb", ".rake"],
	rust: [".rs"],
	scala: [".scala", ".sc"],
	solidity: [".sol"],
	swift: [".swift"],
	typescript: [".ts", ".cts", ".mts"],
	tsx: [".tsx"],
	yaml: [".yml", ".yaml"],
}
