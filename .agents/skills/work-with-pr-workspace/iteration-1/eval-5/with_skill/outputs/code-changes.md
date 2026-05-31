# Code Changes

## File 1: `src/config/schema/comment-checker.ts`

### Before
```typescript
import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
```

### After
```typescript
import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
  /** Regex patterns to exclude from comment detection (e.g. ["^Note:", "^TODO:"]). Case-insensitive. */
  exclude_patterns: z.array(z.string()).optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
```

---

## File 2: `src/hooks/comment-checker/cli.ts`

### Change: `runCommentChecker` function (line 151)

Add `excludePatterns` parameter and pass `--exclude-pattern` flags to the binary.

### Before (line 151)
```typescript
export async function runCommentChecker(input: HookInput, cliPath?: string, customPrompt?: string): Promise<CheckResult> {
  const binaryPath = cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()
  // ...
  try {
    const args = [binaryPath, "check"]
    if (customPrompt) {
      args.push("--prompt", customPrompt)
    }
```

### After
```typescript
export async function runCommentChecker(
  input: HookInput,
  cliPath?: string,
  customPrompt?: string,
  excludePatterns?: string[],
): Promise<CheckResult> {
  const binaryPath = cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()
  // ...
  try {
    const args = [binaryPath, "check"]
    if (customPrompt) {
      args.push("--prompt", customPrompt)
    }
    if (excludePatterns) {
      for (const pattern of excludePatterns) {
        args.push("--exclude-pattern", pattern)
      }
    }
```

---

## File 3: `src/hooks/comment-checker/cli-runner.ts`

### Change: `processWithCli` function (line 43)

Add `excludePatterns` parameter threading.

### Before (line 43-79)
```typescript
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
```

### After
```typescript
export async function processWithCli(
  input: { tool: string; sessionID: string; callID: string },
  pendingCall: PendingCall,
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
  excludePatterns?: string[],
): Promise<void> {
  await withCommentCheckerLock(async () => {
    // ...
    const result = await runCommentChecker(hookInput, cliPath, customPrompt, excludePatterns)
```

### Change: `processApplyPatchEditsWithCli` function (line 87)

Same pattern - thread `excludePatterns` through.

### Before (line 87-120)
```typescript
export async function processApplyPatchEditsWithCli(
  sessionID: string,
  edits: ApplyPatchEdit[],
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  // ...
      const result = await runCommentChecker(hookInput, cliPath, customPrompt)
```

### After
```typescript
export async function processApplyPatchEditsWithCli(
  sessionID: string,
  edits: ApplyPatchEdit[],
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
  excludePatterns?: string[],
): Promise<void> {
  // ...
      const result = await runCommentChecker(hookInput, cliPath, customPrompt, excludePatterns)
```

---

## File 4: `src/hooks/comment-checker/hook.ts`

### Change: Thread `config.exclude_patterns` through to CLI calls

### Before (line 177)
```typescript
await processWithCli(input, pendingCall, output, cliPath, config?.custom_prompt, debugLog)
```

### After
```typescript
await processWithCli(input, pendingCall, output, cliPath, config?.custom_prompt, debugLog, config?.exclude_patterns)
```

### Before (line 147-154)
```typescript
await processApplyPatchEditsWithCli(
  input.sessionID,
  edits,
  output,
  cliPath,
  config?.custom_prompt,
  debugLog,
)
```

### After
```typescript
await processApplyPatchEditsWithCli(
  input.sessionID,
  edits,
  output,
  cliPath,
  config?.custom_prompt,
  debugLog,
  config?.exclude_patterns,
)
```

---

## File 5: `src/hooks/comment-checker/cli.test.ts` (new tests added)

### New test cases appended inside `describe("runCommentChecker", ...)`

```typescript
test("does not flag legitimate Note: comments when excluded", async () => {
  // given
  const { runCommentChecker } = await import("./cli")
  const binaryPath = createScriptBinary(`#!/bin/sh
if [ "$1" != "check" ]; then
  exit 1
fi
# Check if --exclude-pattern is passed
for arg in "$@"; do
  if [ "$arg" = "--exclude-pattern" ]; then
    cat >/dev/null
    exit 0
  fi
done
cat >/dev/null
echo "Detected agent memo comments" 1>&2
exit 2
`)

  // when
  const result = await runCommentChecker(
    createMockInput(),
    binaryPath,
    undefined,
    ["^Note:"],
  )

  // then
  expect(result.hasComments).toBe(false)
})

test("passes multiple exclude patterns to binary", async () => {
  // given
  const { runCommentChecker } = await import("./cli")
  const capturedArgs: string[] = []
  const binaryPath = createScriptBinary(`#!/bin/sh
echo "$@" > /tmp/comment-checker-test-args.txt
cat >/dev/null
exit 0
`)

  // when
  await runCommentChecker(
    createMockInput(),
    binaryPath,
    undefined,
    ["^Note:", "^TODO:"],
  )

  // then
  const { readFileSync } = await import("node:fs")
  const args = readFileSync("/tmp/comment-checker-test-args.txt", "utf-8").trim()
  expect(args).toContain("--exclude-pattern")
  expect(args).toContain("^Note:")
  expect(args).toContain("^TODO:")
})

test("still detects AI slop when no exclude patterns configured", async () => {
  // given
  const { runCommentChecker } = await import("./cli")
  const binaryPath = createScriptBinary(`#!/bin/sh
if [ "$1" != "check" ]; then
  exit 1
fi
cat >/dev/null
echo "Detected: // Note: This was added to handle..." 1>&2
exit 2
`)

  // when
  const result = await runCommentChecker(createMockInput(), binaryPath)

  // then
  expect(result.hasComments).toBe(true)
  expect(result.message).toContain("Detected")
})
```

### New describe block for false positive scenarios

```typescript
describe("false positive scenarios", () => {
  test("legitimate technical Note: should not be flagged", async () => {
    // given
    const { runCommentChecker } = await import("./cli")
    const binaryPath = createScriptBinary(`#!/bin/sh
cat >/dev/null
# Simulate binary that passes when exclude patterns are set
for arg in "$@"; do
  if [ "$arg" = "^Note:" ]; then
    exit 0
  fi
done
echo "// Note: Thread-safe by design" 1>&2
exit 2
`)

    // when
    const resultWithExclude = await runCommentChecker(
      createMockInput(),
      binaryPath,
      undefined,
      ["^Note:"],
    )

    // then
    expect(resultWithExclude.hasComments).toBe(false)
  })

  test("RFC reference Note: should not be flagged", async () => {
    // given
    const { runCommentChecker } = await import("./cli")
    const binaryPath = createScriptBinary(`#!/bin/sh
cat >/dev/null
for arg in "$@"; do
  if [ "$arg" = "^Note:" ]; then
    exit 0
  fi
done
echo "# Note: See RFC 7231" 1>&2
exit 2
`)

    // when
    const result = await runCommentChecker(
      createMockInput(),
      binaryPath,
      undefined,
      ["^Note:"],
    )

    // then
    expect(result.hasComments).toBe(false)
  })

  test("AI memo Note: should still be flagged without exclusion", async () => {
    // given
    const { runCommentChecker } = await import("./cli")
    const binaryPath = createScriptBinary(`#!/bin/sh
cat >/dev/null
echo "// Note: This was added to handle the edge case" 1>&2
exit 2
`)

    // when
    const result = await runCommentChecker(createMockInput(), binaryPath)

    // then
    expect(result.hasComments).toBe(true)
  })
})
```

---

## File 6: `src/hooks/comment-checker/hook.apply-patch.test.ts` (added test)

### New test appended to `describe("comment-checker apply_patch integration")`

```typescript
it("passes exclude_patterns from config to CLI", async () => {
  // given
  const hooks = createCommentCheckerHooks({ exclude_patterns: ["^Note:", "^TODO:"] })

  const input = { tool: "apply_patch", sessionID: "ses_test", callID: "call_test" }
  const output = {
    title: "ok",
    output: "Success. Updated the following files:\nM src/a.ts",
    metadata: {
      files: [
        {
          filePath: "/repo/src/a.ts",
          before: "const a = 1\n",
          after: "// Note: Thread-safe\nconst a = 1\n",
          type: "update",
        },
      ],
    },
  }

  // when
  await hooks["tool.execute.after"](input, output)

  // then
  expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
    "ses_test",
    [{ filePath: "/repo/src/a.ts", before: "const a = 1\n", after: "// Note: Thread-safe\nconst a = 1\n" }],
    expect.any(Object),
    "/tmp/fake-comment-checker",
    undefined,
    expect.any(Function),
    ["^Note:", "^TODO:"],
  )
})
```
