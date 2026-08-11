// SOURCE OF TRUTH: packages/lsp-tools-mcp/src/lsp/server-definitions.ts
// (BUILTIN_SERVERS + LSP_INSTALL_HINTS). This is a hand-maintained snapshot of
// the primary builtin server per reference language, embedded so detect-lsp.ts
// runs standalone in any user project. Mirror command/extensions when that file
// changes.

export interface LanguageServer {
	readonly language: string
	readonly serverId: string
	readonly command: readonly string[]
	readonly extensions: readonly string[]
	readonly installHint: string
}

export const LANGUAGES: readonly LanguageServer[] = [
	{
		language: "typescript",
		serverId: "typescript",
		command: ["typescript-language-server", "--stdio"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		installHint: "npm install -g typescript-language-server typescript",
	},
	{
		language: "python",
		serverId: "basedpyright",
		command: ["basedpyright-langserver", "--stdio"],
		extensions: [".py", ".pyi"],
		installHint: "pip install basedpyright (or: uv tool install basedpyright)",
	},
	{
		language: "go",
		serverId: "gopls",
		command: ["gopls"],
		extensions: [".go"],
		installHint: "go install golang.org/x/tools/gopls@latest",
	},
	{
		language: "rust",
		serverId: "rust",
		command: ["rust-analyzer"],
		extensions: [".rs"],
		installHint: "rustup component add rust-analyzer",
	},
	{
		language: "c-cpp",
		serverId: "clangd",
		command: ["clangd", "--background-index", "--clang-tidy"],
		extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
		installHint: "macOS: brew install llvm | Linux: apt install clangd | https://clangd.llvm.org/installation",
	},
	{
		language: "java",
		serverId: "jdtls",
		command: ["jdtls"],
		extensions: [".java"],
		installHint: "macOS: brew install jdtls | https://github.com/eclipse-jdtls/eclipse.jdt.ls",
	},
	{
		language: "kotlin",
		serverId: "kotlin-ls",
		command: ["kotlin-lsp"],
		extensions: [".kt", ".kts"],
		installHint: "https://github.com/Kotlin/kotlin-lsp",
	},
	{
		language: "csharp",
		serverId: "csharp",
		command: ["csharp-ls"],
		extensions: [".cs"],
		installHint: "dotnet tool install -g csharp-ls",
	},
	{
		language: "razor",
		serverId: "razor",
		command: ["roslyn-language-server", "--stdio"],
		extensions: [".razor", ".cshtml"],
		installHint: "dotnet tool install -g roslyn-language-server --prerelease (see references/csharp/README.md)",
	},
	{
		language: "swift",
		serverId: "sourcekit-lsp",
		command: ["sourcekit-lsp"],
		extensions: [".swift", ".objc", ".objcpp"],
		installHint: "Included with Xcode (xcode-select --install) or the Swift toolchain",
	},
	{
		language: "ruby",
		serverId: "ruby-lsp",
		command: ["rubocop", "--lsp"],
		extensions: [".rb", ".rake", ".gemspec", ".ru"],
		installHint: "gem install ruby-lsp (builtin runs `rubocop --lsp`; gem install rubocop)",
	},
	{
		language: "php",
		serverId: "php",
		command: ["intelephense", "--stdio"],
		extensions: [".php"],
		installHint: "npm install -g intelephense",
	},
	{
		language: "dart",
		serverId: "dart",
		command: ["dart", "language-server", "--lsp"],
		extensions: [".dart"],
		installHint: "Included with the Dart/Flutter SDK",
	},
	{
		language: "elixir",
		serverId: "elixir-ls",
		command: ["elixir-ls"],
		extensions: [".ex", ".exs"],
		installHint: "https://github.com/elixir-lsp/elixir-ls",
	},
	{
		language: "zig",
		serverId: "zls",
		command: ["zls"],
		extensions: [".zig", ".zon"],
		installHint: "https://github.com/zigtools/zls (match zls version to your zig version)",
	},
	{
		language: "lua",
		serverId: "lua-ls",
		command: ["lua-language-server"],
		extensions: [".lua"],
		installHint: "macOS: brew install lua-language-server | https://github.com/LuaLS/lua-language-server",
	},
	{
		language: "bash",
		serverId: "bash",
		command: ["bash-language-server", "start"],
		extensions: [".sh", ".bash", ".zsh", ".ksh"],
		installHint: "npm install -g bash-language-server",
	},
	{
		language: "yaml",
		serverId: "yaml-ls",
		command: ["yaml-language-server", "--stdio"],
		extensions: [".yaml", ".yml"],
		installHint: "npm install -g yaml-language-server",
	},
	{
		language: "terraform",
		serverId: "terraform",
		command: ["terraform-ls", "serve"],
		extensions: [".tf", ".tfvars"],
		installHint: "macOS: brew install hashicorp/tap/terraform-ls | https://github.com/hashicorp/terraform-ls",
	},
	{
		language: "dockerfile",
		serverId: "dockerfile",
		command: ["docker-langserver", "--stdio"],
		extensions: [".dockerfile"],
		installHint: "npm install -g dockerfile-language-server-nodejs",
	},
	{
		language: "haskell",
		serverId: "haskell-language-server",
		command: ["haskell-language-server-wrapper", "--lsp"],
		extensions: [".hs", ".lhs"],
		installHint: "ghcup install hls",
	},
	{
		language: "julia",
		serverId: "julials",
		command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
		extensions: [".jl"],
		installHint: "julia -e 'using Pkg; Pkg.add(\"LanguageServer\")' (see references/julia/README.md)",
	},
] as const

export const PROJECT_CONFIG_FILES: readonly string[] = [
	".codex/lsp-client.json",
	".opencode/lsp.json",
	".omo/lsp.json",
	".omo/lsp-client.json",
] as const
