import type { PolicyMode } from "../../shared/delegation-policy"

export interface DocsDelegationConfig {
  enabled: boolean
  mode: PolicyMode
}

export const DEFAULT_DOCS_DELEGATION_CONFIG: DocsDelegationConfig = {
  enabled: true,
  mode: "block",
}

export const DOCS_PATH_PATTERNS: string[] = [
  "docs/",
  "README.md",
  "README.*.md",
  "CHANGELOG.md",
  "changelog/",
  ".cursor/memory/",
  "context/memory/",
]

export const DOCS_FILE_EXTENSIONS: string[] = [".md", ".mdx"]

export const ALLOWED_AGENTS: string[] = ["document-writer", "docs-publisher"]

export const EXCEPTED_PATHS: string[] = [".cursor/specs/", "context/specs/"]
