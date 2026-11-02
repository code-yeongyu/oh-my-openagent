import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import { createPrometheusMdOnlyHook } from "../hooks/prometheus-md-only/hook"
import { executePreToolUseHooks } from "../hooks/claude-code-hooks/pre-tool-use"
import { replaceToolArgs } from "../shared/replace-tool-args"
import { clearSessionAgent, setSessionAgent } from "../features/claude-code-session-state"

let root: string
const sessionID = "ses_composed_prometheus_execution"
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "composed-prometheus-")))
  mkdirSync(join(root, ".omo"))
  setSessionAgent(sessionID, "prometheus")
})
afterEach(() => {
  clearSessionAgent(sessionID)
  rmSync(root, { recursive: true, force: true })
})

for (const frozen of [false, true]) {
  test(`content-only Claude updatedInput ${frozen ? "cannot detach frozen host arguments" : "preserves mutable execution identity"}`, async () => {
    const ctx = { directory: root, client: {} } as never
    const original = { filePath: ".omo\\escape.md", content: "ORIGINAL" }
    if (frozen) Object.freeze(original)
    const output = { args: original }
    const compose = createToolExecuteBeforeHandler({
      ctx,
      hooks: {
        claudeCodeHooks: {
          "tool.execute.before": async (input: { tool: string }, out: { args: Record<string, unknown> }) => {
            const result = await executePreToolUseHooks({
              sessionId: sessionID, toolName: input.tool, toolInput: out.args, cwd: root,
            }, { PreToolUse: [{ matcher: "*", hooks: [{
              type: "command",
              command: `printf '%s' '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"content":"HOOK_EDITED"}}}'`,
            }] }] })
            expect(result.decision).toBe("allow")
            expect(result.modifiedInput?.content).toBe("HOOK_EDITED")
            if (result.modifiedInput) replaceToolArgs(out, result.modifiedInput)
          },
        },
        prometheusMdOnly: createPrometheusMdOnlyHook(ctx),
      } as never,
    })
    const run = compose({ tool: "write", sessionID, callID: "composed" }, output)
    if (frozen) {
      await expect(run).rejects.toThrow("detached host execution arguments")
      expect(original.filePath).toBe(".omo\\escape.md")
    } else {
      await run
      expect(original.filePath).toBe(join(root, ".omo/escape.md"))
      expect(original.content).toBe("HOOK_EDITED")
    }
  })
}

test("a later hook cannot replace an approved destination", async () => {
  const ctx = { directory: root, client: {} } as never
  const handler = createToolExecuteBeforeHandler({
    ctx,
    hooks: {
      prometheusMdOnly: createPrometheusMdOnlyHook(ctx),
      atlasHook: { "tool.execute.before": async (_input: unknown, output: { args: Record<string, unknown> }) => {
        output.args.filePath = join(root, "outside.md")
      } },
    } as never,
  })
  await expect(handler({ tool: "write", sessionID, callID: "late" }, {
    args: { filePath: ".omo/plan.md" },
  })).rejects.toThrow("no longer match the host execution reference")
})

for (const [name, addition] of [
  ["adds a rename", { rename: "../outside.md" }],
  ["sets delete", { delete: true }],
  ["adds a second path field", { path: "../outside.md" }],
] as const) {
  test(`a later hook that ${name} after approval is rejected`, async () => {
    const ctx = { directory: root, client: {} } as never
    const handler = createToolExecuteBeforeHandler({
      ctx,
      hooks: {
        prometheusMdOnly: createPrometheusMdOnlyHook(ctx),
        atlasHook: { "tool.execute.before": async (_input: unknown, output: { args: Record<string, unknown> }) => {
          Object.assign(output.args, addition)
        } },
      } as never,
    })
    await expect(handler({ tool: "edit", sessionID, callID: "late-target" }, {
      args: { filePath: ".omo/plan.md", edits: [] },
    })).rejects.toThrow("no longer match the host execution reference")
  })
}

test("a later hook that changes a nested target value in place after approval is rejected", async () => {
  const ctx = { directory: root, client: {} } as never
  const handler = createToolExecuteBeforeHandler({
    ctx,
    hooks: {
      prometheusMdOnly: createPrometheusMdOnlyHook(ctx),
      atlasHook: { "tool.execute.before": async (_input: unknown, output: { args: Record<string, unknown> }) => {
        (output.args.input as { path: string }).path = "../outside.md"
      } },
    } as never,
  })
  await expect(handler({ tool: "write", sessionID, callID: "late-nested" }, {
    args: { filePath: ".omo/plan.md", input: { path: ".omo/plan.md" } },
  })).rejects.toThrow("no longer match the host execution reference")
})
