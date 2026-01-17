/**
 * Debugging Injector Hook
 *
 * Tracks fix attempt failures and injects systematic-debugging skill
 * when ≥2 consecutive failures are detected for the same file.
 *
 * Per MERGE-PLAN.md 第33.3章: ≥2次修复失败触发条件
 */

import type { DebugInjectorConfig, DebugInjectorState, FailureRecord } from "./types"
import { DEFAULT_DEBUG_INJECTOR_CONFIG, FIX_ATTEMPT_TOOLS, VERIFICATION_TOOLS, FAILURE_PATTERNS } from "./constants"

// Inline systematic-debugging skill content (loaded at module init)
const SYSTEMATIC_DEBUGGING_SKILL = `# Systematic Debugging (Auto-Injected)

Your fix attempts have failed multiple times. STOP random fixes and follow this process.

## The Iron Law

\`\`\`
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
\`\`\`

## The Four Phases

### Phase 1: Root Cause Investigation (REQUIRED BEFORE ANY FIX)

1. **Read Error Messages Carefully** - Don't skip past errors
2. **Reproduce Consistently** - Can you trigger it reliably?
3. **Check Recent Changes** - What changed that could cause this?
4. **Trace Data Flow** - Where does the bad value originate?

### Phase 2: Pattern Analysis

1. **Find Working Examples** - Locate similar working code
2. **Compare Against References** - Read reference implementation COMPLETELY
3. **Identify Differences** - What's different between working and broken?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** - "I think X is the root cause because Y"
2. **Test Minimally** - Make the SMALLEST possible change
3. **Verify Before Continuing** - Did it work? If not, form NEW hypothesis

### Phase 4: Implementation

1. **Create Failing Test Case** - Simplest possible reproduction
2. **Implement Single Fix** - ONE change at a time
3. **Verify Fix** - Test passes? No other tests broken?

## If 3+ Fixes Failed: Question Architecture

- Is this pattern fundamentally sound?
- Should we refactor architecture vs. continue fixing symptoms?
- **Discuss with your human partner before attempting more fixes**

## Red Flags - STOP and Follow Process

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
`

export interface DebugInjectorHookContext {
  cwd: string
  log?: (message: string) => void
}

export interface DebugInjectorHookOptions {
  config?: Partial<DebugInjectorConfig>
}

/**
 * Check if a tool output indicates a failure
 */
function isFailureOutput(output: string): boolean {
  return FAILURE_PATTERNS.some((pattern) => pattern.test(output))
}

/**
 * Clean up old failure records outside the time window
 */
function cleanupOldFailures(
  failures: Map<string, FailureRecord[]>,
  windowMs: number
): Map<string, FailureRecord[]> {
  const now = Date.now()
  const cleaned = new Map<string, FailureRecord[]>()

  for (const [filePath, records] of failures) {
    const validRecords = records.filter((r) => now - r.timestamp < windowMs)
    if (validRecords.length > 0) {
      cleaned.set(filePath, validRecords)
    }
  }

  return cleaned
}

/**
 * Create the Debugging Injector Hook
 */
export function createDebugInjectorHook(
  _ctx: DebugInjectorHookContext,
  options: DebugInjectorHookOptions = {}
) {
  const config: DebugInjectorConfig = {
    ...DEFAULT_DEBUG_INJECTOR_CONFIG,
    ...options.config,
  }

  // Track state per session
  const state: DebugInjectorState = {
    failures: new Map(),
    injectedFiles: new Set(),
  }

  // Track the last file that was edited (to associate failures with files)
  let lastEditedFile: string | null = null

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
      // Check if hook is enabled
      if (!config.enabled) {
        return
      }

      const toolLower = input.tool.toLowerCase()

      // Track edit attempts to know which file we're working on
      if (FIX_ATTEMPT_TOOLS.includes(toolLower)) {
        const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as
          | string
          | undefined
        if (filePath) {
          lastEditedFile = filePath
        }
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      }
    ): Promise<void> => {
      // Check if hook is enabled
      if (!config.enabled) {
        return
      }

      const toolLower = input.tool.toLowerCase()

      // Only track verification tools for failure detection
      if (!VERIFICATION_TOOLS.includes(toolLower)) {
        return
      }

      // Check if output indicates failure
      const outputContent = (output.content ?? "") as string
      const hasFailure = isFailureOutput(outputContent)

      if (!hasFailure) {
        // Success - reset failure count for this file if configured
        if (config.reset_on_success && lastEditedFile) {
          state.failures.delete(lastEditedFile)
          state.injectedFiles.delete(lastEditedFile)
        }
        return
      }

      // We have a failure - track it
      if (!lastEditedFile) {
        return
      }

      // Clean up old failures
      state.failures = cleanupOldFailures(state.failures, config.failure_window_ms)

      // Add new failure record
      const records = state.failures.get(lastEditedFile) ?? []
      records.push({
        filePath: lastEditedFile,
        timestamp: Date.now(),
        errorMessage: outputContent.slice(0, 500), // Truncate long error messages
      })
      state.failures.set(lastEditedFile, records)

      // Check if we've hit the threshold
      if (records.length >= config.failure_threshold) {
        // Only inject once per file per session
        if (config.inject_skill_on_threshold && !state.injectedFiles.has(lastEditedFile)) {
          state.injectedFiles.add(lastEditedFile)

          output.messages = output.messages || []
          output.messages.push({
            role: "system",
            content: `[DEBUGGING SKILL - AUTO-INJECTED BY DEBUGGING INJECTOR]

You have had ${records.length} failed fix attempts for "${lastEditedFile}".

STOP random fixes and follow systematic debugging.

${SYSTEMATIC_DEBUGGING_SKILL}`,
          })
        }
      }
    },
  }
}

export type { DebugInjectorConfig } from "./types"
