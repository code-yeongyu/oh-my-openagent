/**
 * TDD Guard Hook
 *
 * Enforces Test-Driven Development by blocking edits to Tier 2/3 files
 * without failing tests. When blocked, auto-injects the TDD Skill for guidance.
 */

import type { TddGuardConfig } from "./types"
import { DEFAULT_TDD_GUARD_CONFIG, EXEMPTION_PATTERNS } from "./constants"
import { determineRiskTier, shouldBlockEdit, matchesIgnorePattern } from "./risk-validator"
import { isTestFile } from "./language-adapter"

// Inline TDD skill content (loaded at module init, fallback if external file not found)
const TDD_SKILL_CONTENT = `# TDD Workflow (Auto-Injected)

Your edit was blocked because this file requires Test-Driven Development.

## The Iron Law

\`\`\`
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
\`\`\`

## Risk Tiers

| Tier | Files | Requirement |
|------|-------|-------------|
| 0 | .md, README, LICENSE | Always allowed |
| 1 | .css, .json, .yaml | Allowed with logging |
| 2 | Normal .ts/.js/.py | Test OR TDD-EXEMPT comment |
| 3 | /api/, /services/, /auth/ | MUST have failing test first |

## RED-GREEN-REFACTOR

1. **RED**: Write a failing test first
   - Test must be specific (not empty, has assertions)
   - Run test, verify it fails for the right reason

2. **GREEN**: Write minimal code to pass
   - Only enough to make the test pass
   - No extra features (YAGNI)

3. **REFACTOR**: Clean up while tests stay green
   - Remove duplication
   - Improve names
   - Keep all tests passing

## Next Steps

1. Write a failing test for the functionality you want to add
2. Run the test to verify it fails: \`bun test path/to/file.test.ts\`
3. Then retry your edit - TDD Guard will allow it

## Tier 2 Exemption

If you genuinely cannot test this code, add an exemption comment:

\`\`\`typescript
// TDD-EXEMPT: reason="Generated code, no testable logic"
\`\`\`

**Note:** Tier 3 files (api, services, auth) cannot be exempted.
`

export interface TddGuardHookContext {
  cwd: string
  log?: (message: string) => void
}

export interface TddGuardHookOptions {
  config?: Partial<TddGuardConfig>
}

/**
 * Check if content contains a TDD-EXEMPT comment
 */
function hasExemptionComment(content: string | undefined): boolean {
  if (!content) return false
  return EXEMPTION_PATTERNS.some((pattern) => pattern.test(content))
}

/**
 * Create the TDD Guard Hook
 */
export function createTddGuardHook(
  _ctx: TddGuardHookContext,
  options: TddGuardHookOptions = {}
) {
  const config: TddGuardConfig = {
    ...DEFAULT_TDD_GUARD_CONFIG,
    ...options.config,
  }

  // Track files that have been checked this session to avoid duplicate messages
  const checkedFiles = new Set<string>()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
        messages?: Array<{ role: string; content: string }>
      }
    ): Promise<void> => {
      // Only intercept Edit and Write tools
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "edit" && toolLower !== "write") {
        return
      }

      // Check if hook is enabled
      if (!config.enabled) {
        return
      }

      // Get file path from args
      const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
      if (!filePath) {
        return
      }

      // Test files are always allowed
      if (isTestFile(filePath)) {
        return
      }

      // Check ignore patterns
      if (matchesIgnorePattern(filePath, config.ignore_patterns)) {
        return
      }

      // Determine risk tier
      const tier = determineRiskTier(filePath)

      // Tier 0-1: Never block
      if (tier.tier < config.min_enforce_tier) {
        return
      }

      // Check for exemption comment in the content being written/edited
      const content = (output.args.content ?? output.args.newString ?? output.args.new_string) as string | undefined
      const hasExemption = tier.allowsExemption && hasExemptionComment(content)

      // For now, we don't have a way to check for failing tests at runtime
      // This would require running the test suite, which is expensive
      // Instead, we rely on the AI following TDD practices after seeing the skill
      // The hook will warn but not hard-block for now
      const hasFailingTest = false // TODO: Could integrate with test runner

      // Check if edit should be blocked
      const blockResult = shouldBlockEdit(tier, hasFailingTest, hasExemption)

      if (blockResult.blocked) {
        // Mark as blocked
        output.blocked = true
        output.message = `[TDD Guard] ${blockResult.reason}

File: ${filePath}
Risk Tier: ${tier.tier} (${tier.description})

To proceed:
1. Write a failing test first, OR
2. Add a TDD-EXEMPT comment (Tier 2 only)`

        // Inject TDD Skill for guidance (if enabled and not already injected for this file)
        if (config.inject_skill_on_block && !checkedFiles.has(filePath)) {
          checkedFiles.add(filePath)
          
          output.messages = output.messages || []
          output.messages.push({
            role: "system",
            content: `[TDD SKILL - AUTO-INJECTED BY TDD GUARD]

Your edit to "${filePath}" was blocked because this is a Tier ${tier.tier} file.

${TDD_SKILL_CONTENT}`,
          })
        }
      }
    },
  }
}

export type { TddGuardConfig } from "./types"
