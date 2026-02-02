import type { KimiReviewConfig } from "./types"

export const DEFAULT_MODEL = "moonshot/kimi-k2.5"

export const DEFAULT_CONFIG: Required<KimiReviewConfig> = {
  enabled: true,
  model: DEFAULT_MODEL,
  blockOnCritical: true,
  reviewThreshold: "all",
  extensions: [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".kt", ".swift",
    ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".env",
    ".sh", ".bash", ".zsh",
    ".md", ".mdx",
  ],
  ignorePatterns: [
    "**/test/**", "**/*.test.ts", "**/*.spec.ts", "**/node_modules/**", "**/__tests__/**",
    "**/package-lock.json", "**/bun.lock", "**/yarn.lock", "**/pnpm-lock.yaml",
  ],
  timeoutMs: 30000,
}

export const CODE_EXTENSIONS = new Set(DEFAULT_CONFIG.extensions)

export const TRIGGER_TOOLS = ["write", "edit"] as const
export type TriggerTool = typeof TRIGGER_TOOLS[number]

export const REVIEW_PROMPT_TEMPLATE = `You are a meticulous reviewer. Review the following change and identify issues.

File: {{filePath}}
Operation: {{operation}}

{{#if oldContent}}
Previous content:
\`\`\`
{{oldContent}}
\`\`\`
{{/if}}

{{#if newContent}}
New content:
\`\`\`
{{newContent}}
\`\`\`
{{/if}}

{{#if content}}
Content:
\`\`\`
{{content}}
\`\`\`
{{/if}}

Respond in this EXACT format:

REVIEW: [APPROVED or ISSUES_FOUND]

[CRITICAL] (only if critical issues exist)
- Issue description
  File: path:line (if applicable)
  Fix: How to resolve

[WARNING] (only if warnings exist)
- Issue description
  Suggestion: Recommended improvement

[STYLE] (only if style issues exist)
- Minor style/convention issue

For CODE files, focus on:
1. Security vulnerabilities (injection, XSS, secrets exposure)
2. Logic errors and bugs
3. Type safety issues
4. Error handling gaps
5. Performance problems

For CONFIG files (.json, .yaml, .toml, .env), focus on:
1. Secrets/credentials accidentally committed
2. Invalid syntax or structure
3. Missing required fields
4. Inconsistent or conflicting settings
5. Security misconfigurations

For DOCUMENTATION (.md), focus on:
1. Accuracy of technical claims
2. Outdated or misleading information
3. Missing critical warnings

Use the SESSION CONTEXT (if provided) to understand:
1. What the user is trying to accomplish
2. Whether the change aligns with the stated goal
3. Potential conflicts with other recent changes

Be concise and specific. Only flag REAL issues, not preferences.
CRITICAL = must fix before proceeding
WARNING = should fix but not blocking
STYLE = optional improvements`

export const APPROVED_RESPONSE = "[KIMI REVIEW] APPROVED - No issues found."

export const buildReviewBlockMessage = (issues: string[]): string => {
  return `[KIMI REVIEW - BLOCKING]

Critical issues found. You MUST fix these before proceeding:

${issues.join("\n")}

DO NOT continue until these issues are resolved.`
}
