import type { LSPServerConfig } from "./types"

export const SYMBOL_KIND_MAP: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
}

export const SEVERITY_MAP: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint",
}

export const DEFAULT_MAX_REFERENCES = 200
export const DEFAULT_MAX_SYMBOLS = 200
export const DEFAULT_MAX_DIAGNOSTICS = 200

export const BUILTIN_SERVERS: Record<string, Omit<LSPServerConfig, "id">> = {
  typescript: {
    command: ["typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  },
  deno: {
    command: ["deno", "lsp"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  },
  vue: {
    command: ["vue-language-server", "--stdio"],
    extensions: [".vue"],
  },
  eslint: {
    command: ["vscode-eslint-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  },
  gopls: {
    command: ["gopls"],
    extensions: [".go"],
  },
  "ruby-lsp": {
    command: ["rubocop", "--lsp"],
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
  },
  basedpyright: {
    command: ["basedpyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
  },
  pyright: {
    command: ["pyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
  },
  ruff: {
    command: ["ruff", "server"],
    extensions: [".py", ".pyi"],
  },
  "elixir-ls": {
    command: ["elixir-ls"],
    extensions: [".ex", ".exs"],
  },
  zls: {
    command: ["zls"],
    extensions: [".zig", ".zon"],
  },
  csharp: {
    command: ["csharp-ls"],
    extensions: [".cs"],
  },
  "sourcekit-lsp": {
    command: ["sourcekit-lsp"],
    extensions: [".swift", ".objc", ".objcpp"],
  },
  rust: {
    command: ["rust-analyzer"],
    extensions: [".rs"],
  },
  clangd: {
    command: ["clangd", "--background-index", "--clang-tidy"],
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  },
  svelte: {
    command: ["svelteserver", "--stdio"],
    extensions: [".svelte"],
  },
  astro: {
    command: ["astro-ls", "--stdio"],
    extensions: [".astro"],
  },
  "bash-ls": {
    command: ["bash-language-server", "start"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
  },
  jdtls: {
    command: ["jdtls"],
    extensions: [".java"],
  },
  "yaml-ls": {
    command: ["yaml-language-server", "--stdio"],
    extensions: [".yaml", ".yml"],
  },
  "lua-ls": {
    command: ["lua-language-server"],
    extensions: [".lua"],
  },
  php: {
    command: ["intelephense", "--stdio"],
    extensions: [".php"],
  },
  dart: {
    command: ["dart", "language-server", "--lsp"],
    extensions: [".dart"],
  },
}

export const EXT_TO_LANG: Record<string, string> = {
  ".py": "python",
  ".pyi": "python",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".objc": "objective-c",
  ".objcpp": "objective-cpp",
  ".java": "java",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".lua": "lua",
  ".swift": "swift",
  ".cs": "csharp",
  ".php": "php",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".zig": "zig",
  ".zon": "zig",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".fish": "fish",
  ".md": "markdown",
  ".tf": "terraform",
  ".tfvars": "terraform",
}
