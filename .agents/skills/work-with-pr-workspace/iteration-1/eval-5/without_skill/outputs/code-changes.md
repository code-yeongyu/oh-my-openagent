# Code Changes: comment-checker false positive fix

## Change 1: Extend config schema

**File: `src/config/schema/comment-checker.ts`**

```typescript
// BEFORE
import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
```

```typescript
// AFTER
import { z } from "zod"

const DEFAULT_ALLOWED_COMMENT_PREFIXES = [
  "note:",
  "todo:",
  "fixme:",
  "hack:",
  "xxx:",
  "warning:",
  "important:",
  "bug:",
  "optimize:",
  "workaround:",
  "safety:",
  "security:",
  "perf:",
  "see:",
  "ref:",
  "cf.",
]

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
  /** Comment prefixes considered legitimate (not AI slop). Case-insensitive. Defaults include Note:, TODO:, FIXME:, etc. */
  allowed_comment_prefixes: z.array(z.string()).optional().default(DEFAULT_ALLOWED_COMMENT_PREFIXES),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
```

## Change 2: Create allowed-prefix-filter module

**File: `src/hooks/comment-checker/allowed-prefix-filter.ts`** (NEW)

```typescript
const COMMENT_XML_REGEX = /<comment\s+line-number="\d+">([\s\S]*?)<\/comment>/g
const COMMENTS_BLOCK_REGEX = /<comments\s+file="[^"]*">\s*([\s\S]*?)\s*<\/comments>/g
const AGENT_MEMO_HEADER_REGEX = /🚨 AGENT MEMO COMMENT DETECTED.*?---\n\n/s

function stripCommentPrefix(text: string): string {
  let stripped = text.trim()
  for (const prefix of ["//", "#", "/*", "--", "*"]) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length).trim()
      break
    }
  }
  return stripped
}

function isAllowedComment(commentText: string, allowedPrefixes: string[]): boolean {
  const stripped = stripCommentPrefix(commentText).toLowerCase()
  return allowedPrefixes.some((prefix) => stripped.startsWith(prefix.toLowerCase()))
}

function extractCommentTexts(xmlBlock: string): string[] {
  const texts: string[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(COMMENT_XML_REGEX.source, COMMENT_XML_REGEX.flags)
  while ((match = regex.exec(xmlBlock)) !== null) {
    texts.push(match[1])
  }
  return texts
}

export function filterAllowedComments(
  message: string,
  allowedPrefixes: string[],
): { hasRemainingComments: boolean; filteredMessage: string } {
  if (!message || allowedPrefixes.length === 0) {
    return { hasRemainingComments: true, filteredMessage: message }
  }

  const commentTexts = extractCommentTexts(message)

  if (commentTexts.length === 0) {
    return { hasRemainingComments: true, filteredMessage: message }
  }

  const disallowedComments = commentTexts.filter(
    (text) => !isAllowedComment(text, allowedPrefixes),
  )

  if (disallowedComments.length === 0) {
    return { hasRemainingComments: false, filteredMessage: "" }
  }

  if (disallowedComments.length === commentTexts.length) {
    return { hasRemainingComments: true, filteredMessage: message }
  }

  let filteredMessage = message
  for (const text of commentTexts) {
    if (isAllowedComment(text, allowedPrefixes)) {
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const lineRegex = new RegExp(`\\s*<comment\\s+line-number="\\d+">${escapedText}</comment>\\n?`, "g")
      filteredMessage = filteredMessage.replace(lineRegex, "")
    }
  }

  filteredMessage = filteredMessage.replace(AGENT_MEMO_HEADER_REGEX, "")

  return { hasRemainingComments: true, filteredMessage }
}
```

## Change 3: Thread config through cli-runner.ts

**File: `src/hooks/comment-checker/cli-runner.ts`**

```typescript
// BEFORE (processWithCli signature and body)
export async function processWithCli(
  input: { tool: string; sessionID: string; callID: string },
  pendingCall: PendingCall,
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  await withCommentCheckerLock(async () => {
    // ...
    const result = await runCommentChecker(hookInput, cliPath, customPrompt)
    if (result.hasComments && result.message) {
      debugLog("CLI detected comments, appending message")
      output.output += `\n\n${result.message}`
    } else {
      debugLog("CLI: no comments detected")
    }
  }, undefined, debugLog)
}
```

```typescript
// AFTER
import { filterAllowedComments } from "./allowed-prefix-filter"

export async function processWithCli(
  input: { tool: string; sessionID: string; callID: string },
  pendingCall: PendingCall,
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  allowedPrefixes: string[],
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  await withCommentCheckerLock(async () => {
    void input
    debugLog("using CLI mode with path:", cliPath)

    const hookInput: HookInput = {
      session_id: pendingCall.sessionID,
      tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1),
      transcript_path: "",
      cwd: process.cwd(),
      hook_event_name: "PostToolUse",
      tool_input: {
        file_path: pendingCall.filePath,
        content: pendingCall.content,
        old_string: pendingCall.oldString,
        new_string: pendingCall.newString,
        edits: pendingCall.edits,
      },
    }

    const result = await runCommentChecker(hookInput, cliPath, customPrompt)

    if (result.hasComments && result.message) {
      const { hasRemainingComments, filteredMessage } = filterAllowedComments(
        result.message,
        allowedPrefixes,
      )
      if (hasRemainingComments && filteredMessage) {
        debugLog("CLI detected comments, appending filtered message")
        output.output += `\n\n${filteredMessage}`
      } else {
        debugLog("CLI: all detected comments matched allowed prefixes, suppressing")
      }
    } else {
      debugLog("CLI: no comments detected")
    }
  }, undefined, debugLog)
}

// Same change applied to processApplyPatchEditsWithCli - add allowedPrefixes parameter
export async function processApplyPatchEditsWithCli(
  sessionID: string,
  edits: ApplyPatchEdit[],
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  allowedPrefixes: string[],
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  debugLog("processing apply_patch edits:", edits.length)

  for (const edit of edits) {
    await withCommentCheckerLock(async () => {
      const hookInput: HookInput = {
        session_id: sessionID,
        tool_name: "Edit",
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: "PostToolUse",
        tool_input: {
          file_path: edit.filePath,
          old_string: edit.before,
          new_string: edit.after,
        },
      }

      const result = await runCommentChecker(hookInput, cliPath, customPrompt)

      if (result.hasComments && result.message) {
        const { hasRemainingComments, filteredMessage } = filterAllowedComments(
          result.message,
          allowedPrefixes,
        )
        if (hasRemainingComments && filteredMessage) {
          debugLog("CLI detected comments for apply_patch file:", edit.filePath)
          output.output += `\n\n${filteredMessage}`
        }
      }
    }, undefined, debugLog)
  }
}
```

## Change 4: Update hook.ts to pass config

**File: `src/hooks/comment-checker/hook.ts`**

```typescript
// BEFORE (in tool.execute.after handler, around line 177)
await processWithCli(input, pendingCall, output, cliPath, config?.custom_prompt, debugLog)

// AFTER
const allowedPrefixes = config?.allowed_comment_prefixes ?? []
await processWithCli(input, pendingCall, output, cliPath, config?.custom_prompt, allowedPrefixes, debugLog)
```

```typescript
// BEFORE (in apply_patch section, around line 147-154)
await processApplyPatchEditsWithCli(
  input.sessionID,
  edits,
  output,
  cliPath,
  config?.custom_prompt,
  debugLog,
)

// AFTER
const allowedPrefixes = config?.allowed_comment_prefixes ?? []
await processApplyPatchEditsWithCli(
  input.sessionID,
  edits,
  output,
  cliPath,
  config?.custom_prompt,
  allowedPrefixes,
  debugLog,
)
```

## Change 5: Test file for allowed-prefix-filter

**File: `src/hooks/comment-checker/allowed-prefix-filter.test.ts`** (NEW)

```typescript
import { describe, test, expect } from "bun:test"

import { filterAllowedComments } from "./allowed-prefix-filter"

const DEFAULT_PREFIXES = [
  "note:", "todo:", "fixme:", "hack:", "xxx:", "warning:",
  "important:", "bug:", "optimize:", "workaround:", "safety:",
  "security:", "perf:", "see:", "ref:", "cf.",
]

function buildMessage(comments: { line: number; text: string }[], filePath = "/tmp/test.ts"): string {
  const xml = comments
    .map((c) => `\t<comment line-number="${c.line}">${c.text}</comment>`)
    .join("\n")
  return `COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED\n\n` +
    `Your recent changes contain comments or docstrings, which triggered this hook.\n` +
    `Detected comments/docstrings:\n` +
    `<comments file="${filePath}">\n${xml}\n</comments>\n`
}

describe("allowed-prefix-filter", () => {
  describe("#given default allowed prefixes", () => {
    describe("#when message contains only Note: comments", () => {
      test("#then should suppress the entire message", () => {
        const message = buildMessage([
          { line: 5, text: "// Note: Thread-safe implementation" },
          { line: 12, text: "// NOTE: See RFC 7231 for details" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
        expect(result.filteredMessage).toBe("")
      })
    })

    describe("#when message contains only TODO/FIXME comments", () => {
      test("#then should suppress the entire message", () => {
        const message = buildMessage([
          { line: 3, text: "// TODO: implement caching" },
          { line: 7, text: "// FIXME: race condition here" },
          { line: 15, text: "# HACK: workaround for upstream bug" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
        expect(result.filteredMessage).toBe("")
      })
    })

    describe("#when message contains only AI slop comments", () => {
      test("#then should keep the entire message", () => {
        const message = buildMessage([
          { line: 2, text: "// Added new validation logic" },
          { line: 8, text: "// Refactored for better performance" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(true)
        expect(result.filteredMessage).toBe(message)
      })
    })

    describe("#when message contains mix of legitimate and slop comments", () => {
      test("#then should keep message but remove allowed comment XML entries", () => {
        const message = buildMessage([
          { line: 5, text: "// Note: Thread-safe implementation" },
          { line: 10, text: "// Changed from old API to new API" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(true)
        expect(result.filteredMessage).not.toContain("Thread-safe implementation")
        expect(result.filteredMessage).toContain("Changed from old API to new API")
      })
    })

    describe("#when Note: comment has lowercase prefix", () => {
      test("#then should still be treated as allowed (case-insensitive)", () => {
        const message = buildMessage([
          { line: 1, text: "// note: this is case insensitive" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
      })
    })

    describe("#when comment uses hash prefix", () => {
      test("#then should strip prefix before matching", () => {
        const message = buildMessage([
          { line: 1, text: "# Note: Python style comment" },
          { line: 5, text: "# TODO: something to do" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
      })
    })

    describe("#when comment has Security: prefix", () => {
      test("#then should be treated as allowed", () => {
        const message = buildMessage([
          { line: 1, text: "// Security: validate input before processing" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
      })
    })

    describe("#when comment has Warning: prefix", () => {
      test("#then should be treated as allowed", () => {
        const message = buildMessage([
          { line: 1, text: "// WARNING: This mutates the input array" },
        ])

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
      })
    })
  })

  describe("#given empty allowed prefixes", () => {
    describe("#when any comments are detected", () => {
      test("#then should pass through unfiltered", () => {
        const message = buildMessage([
          { line: 1, text: "// Note: this should pass through" },
        ])

        const result = filterAllowedComments(message, [])

        expect(result.hasRemainingComments).toBe(true)
        expect(result.filteredMessage).toBe(message)
      })
    })
  })

  describe("#given custom allowed prefixes", () => {
    describe("#when comment matches custom prefix", () => {
      test("#then should suppress it", () => {
        const message = buildMessage([
          { line: 1, text: "// PERF: O(n log n) complexity" },
        ])

        const result = filterAllowedComments(message, ["perf:"])

        expect(result.hasRemainingComments).toBe(false)
      })
    })
  })

  describe("#given empty message", () => {
    describe("#when filterAllowedComments is called", () => {
      test("#then should return hasRemainingComments true with empty string", () => {
        const result = filterAllowedComments("", DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(true)
        expect(result.filteredMessage).toBe("")
      })
    })
  })

  describe("#given message with agent memo header", () => {
    describe("#when all flagged comments are legitimate Note: comments", () => {
      test("#then should suppress agent memo header along with comments", () => {
        const message =
          "🚨 AGENT MEMO COMMENT DETECTED - CODE SMELL ALERT 🚨\n\n" +
          "⚠️  AGENT MEMO COMMENTS DETECTED - THIS IS A CODE SMELL  ⚠️\n\n" +
          "You left \"memo-style\" comments...\n\n---\n\n" +
          "Your recent changes contain comments...\n" +
          "Detected comments/docstrings:\n" +
          '<comments file="/tmp/test.ts">\n' +
          '\t<comment line-number="5">// Note: Thread-safe</comment>\n' +
          "</comments>\n"

        const result = filterAllowedComments(message, DEFAULT_PREFIXES)

        expect(result.hasRemainingComments).toBe(false)
        expect(result.filteredMessage).toBe("")
      })
    })
  })
})
```

## Change 6: Update existing test for new parameter

**File: `src/hooks/comment-checker/hook.apply-patch.test.ts`**

The `processApplyPatchEditsWithCli` mock needs to account for the new `allowedPrefixes` parameter:

```typescript
// BEFORE (line 58)
expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
  "ses_test",
  [
    { filePath: "/repo/src/a.ts", before: "const a = 1\n", after: "// comment\nconst a = 1\n" },
    { filePath: "/repo/src/new.ts", before: "const b = 1\n", after: "// moved comment\nconst b = 1\n" },
  ],
  expect.any(Object),
  "/tmp/fake-comment-checker",
  undefined,
  expect.any(Function),
)

// AFTER - add allowed_comment_prefixes argument
expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
  "ses_test",
  [
    { filePath: "/repo/src/a.ts", before: "const a = 1\n", after: "// comment\nconst a = 1\n" },
    { filePath: "/repo/src/new.ts", before: "const b = 1\n", after: "// moved comment\nconst b = 1\n" },
  ],
  expect.any(Object),
  "/tmp/fake-comment-checker",
  undefined,
  expect.any(Array),
  expect.any(Function),
)
```

## Summary of all touched files

| File | Action | Description |
|------|--------|-------------|
| `src/config/schema/comment-checker.ts` | Modified | Add `allowed_comment_prefixes` with defaults |
| `src/hooks/comment-checker/allowed-prefix-filter.ts` | **New** | Post-processing filter for legitimate comment prefixes |
| `src/hooks/comment-checker/allowed-prefix-filter.test.ts` | **New** | 11 test cases covering false positives and edge cases |
| `src/hooks/comment-checker/cli-runner.ts` | Modified | Thread `allowedPrefixes` param, apply filter after binary result |
| `src/hooks/comment-checker/hook.ts` | Modified | Pass `allowed_comment_prefixes` from config to CLI runner |
| `src/hooks/comment-checker/hook.apply-patch.test.ts` | Modified | Update mock assertions for new parameter |
