import type { LanguageConfig } from "./types"

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  py: "python",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "tsx",
  go: "golang",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  rs: "rust",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  cs: "csharp",
  swift: "swift",
  ex: "elixir",
  exs: "elixir",
  lua: "lua",
  php: "php",
  ml: "ocaml",
  mli: "ocaml",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  hcl: "hcl",
  tf: "hcl",
  dockerfile: "dockerfile",
  proto: "protobuf",
  svelte: "svelte",
  elm: "elm",
  groovy: "groovy",
  cue: "cue",
}

export const QUERY_TEMPLATES: Record<string, string> = {
  python: "(comment) @comment",
  javascript: "(comment) @comment",
  typescript: "(comment) @comment",
  tsx: "(comment) @comment",
  golang: "(comment) @comment",
  rust: `
    (line_comment) @comment
    (block_comment) @comment
  `,
  kotlin: `
    (line_comment) @comment
    (multiline_comment) @comment
  `,
  java: `
    (line_comment) @comment
    (block_comment) @comment
  `,
  c: "(comment) @comment",
  cpp: "(comment) @comment",
  csharp: "(comment) @comment",
  ruby: "(comment) @comment",
  bash: "(comment) @comment",
  swift: "(comment) @comment",
  elixir: "(comment) @comment",
  lua: "(comment) @comment",
  php: "(comment) @comment",
  ocaml: "(comment) @comment",
  sql: "(comment) @comment",
  html: "(comment) @comment",
  css: "(comment) @comment",
  yaml: "(comment) @comment",
  toml: "(comment) @comment",
  hcl: "(comment) @comment",
  dockerfile: "(comment) @comment",
  protobuf: "(comment) @comment",
  svelte: "(comment) @comment",
  elm: "(comment) @comment",
  groovy: "(comment) @comment",
  cue: "(comment) @comment",
  scala: "(comment) @comment",
}

export const DOCSTRING_QUERIES: Record<string, string> = {
  python: `
    (module . (expression_statement (string) @docstring))
    (class_definition body: (block . (expression_statement (string) @docstring)))
    (function_definition body: (block . (expression_statement (string) @docstring)))
  `,
  javascript: `
    (comment) @jsdoc
    (#match? @jsdoc "^/\\\\*\\\\*")
  `,
  typescript: `
    (comment) @jsdoc
    (#match? @jsdoc "^/\\\\*\\\\*")
  `,
  tsx: `
    (comment) @jsdoc
    (#match? @jsdoc "^/\\\\*\\\\*")
  `,
  java: `
    (comment) @javadoc
    (#match? @javadoc "^/\\\\*\\\\*")
  `,
}

export const BDD_KEYWORDS = new Set([
  "given",
  "when",
  "then",
  "arrange",
  "act",
  "assert",
  "when & then",
  "when&then",
])

export const TYPE_CHECKER_PREFIXES = [
  "type:",
  "noqa",
  "pyright:",
  "ruff:",
  "mypy:",
  "pylint:",
  "flake8:",
  "pyre:",
  "pytype:",
  "eslint-disable",
  "eslint-enable",
  "eslint-ignore",
  "prettier-ignore",
  "ts-ignore",
  "ts-expect-error",
  "ts-nocheck",
  "clippy::",
  "allow(",
  "deny(",
  "warn(",
  "forbid(",
  "nolint",
  "go:generate",
  "go:build",
  "go:embed",
  "coverage:",
  "c8 ignore",
  "biome-ignore",
  "region",
  "endregion",
]

export const HOOK_MESSAGE_HEADER = `COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored, even if you receive it multiple times.
You MUST provide corresponding explanation or action for EACH occurrence of this message.
Ignoring this message or failing to respond appropriately is strictly prohibited.

PRIORITY-BASED ACTION GUIDELINES:

1. This is a comment/docstring that already existed before
\t-> Explain to the user that this is an existing comment/docstring and proceed (justify it)

2. This is a newly written comment: but it's in given, when, then format
\t-> Tell the user it's a BDD comment and proceed (justify it)
\t-> Note: This applies to comments only, not docstrings

3. This is a newly written comment/docstring: but it's a necessary comment/docstring
\t-> Tell the user why this comment/docstring is absolutely necessary and proceed (justify it)
\t-> Examples of necessary comments: complex algorithms, security-related, performance optimization, regex, mathematical formulas
\t-> Examples of necessary docstrings: public API documentation, complex module/class interfaces
\t-> IMPORTANT: Most docstrings are unnecessary if the code is self-explanatory. Only keep truly essential ones.

4. This is a newly written comment/docstring: but it's an unnecessary comment/docstring
\t-> Apologize to the user and remove the comment/docstring.
\t-> Make the code itself clearer so it can be understood without comments/docstrings.
\t-> For verbose docstrings: refactor code to be self-documenting instead of adding lengthy explanations.

MANDATORY REQUIREMENT: You must acknowledge this hook message and take one of the above actions.
Review in the above priority order and take the corresponding action EVERY TIME this appears.

Detected comments/docstrings:
`

export function getLanguageByExtension(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf(".")
  if (lastDot === -1) {
    const baseName = filePath.split("/").pop()?.toLowerCase()
    if (baseName === "dockerfile") return "dockerfile"
    return null
  }
  const ext = filePath.slice(lastDot + 1).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] ?? null
}
