/**
 * Codebase Assessment Hook Constants
 *
 * Collects project configuration info for PHASE 1 assessment.
 * Implements Task 8.1 from SUBAGENTS-COMPARISON.md
 */

export const HOOK_NAME = "codebase-assessment"

export const CONFIG_FILES = [
  // Linters
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "biome.json",
  
  // Formatters
  ".prettierrc",
  ".prettierrc.js",
  ".prettierrc.json",
  "prettier.config.js",
  
  // TypeScript
  "tsconfig.json",
  "jsconfig.json",
  
  // Package managers
  "package.json",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  
  // Testing
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
  
  // Build tools
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "rollup.config.js",
  "esbuild.config.js",
  
  // Git
  ".gitignore",
  ".git",
] as const

export const CODEBASE_STATES = {
  DISCIPLINED: "disciplined",
  TRANSITIONAL: "transitional",
  LEGACY: "legacy",
  GREENFIELD: "greenfield",
} as const

export type CodebaseState = typeof CODEBASE_STATES[keyof typeof CODEBASE_STATES]

export interface AssessmentResult {
  state: CodebaseState
  hasLinter: boolean
  hasFormatter: boolean
  hasTypeScript: boolean
  hasTests: boolean
  packageManager: "bun" | "npm" | "yarn" | "pnpm" | "unknown"
  configFilesFound: string[]
  recommendation: string
}
