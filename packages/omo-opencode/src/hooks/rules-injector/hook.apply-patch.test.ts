import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createRulesInjectorHook } from "./hook"
import { clearParsedRuleCache } from "./injector"

const TS_RULE = "[Rule: .github/instructions/ts.instructions.md]"
const MD_RULE = "[Rule: .github/instructions/md.instructions.md]"
const SQL_RULE = "[Rule: .github/instructions/sql.instructions.md]"

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function patch(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n")
}

describe("rules-injector apply_patch", () => {
  let testRoot: string
  let projectRoot: string
  let hook: ReturnType<typeof createRulesInjectorHook>
  let callCount = 0

  function writeRule(name: string, applyTo: string, body: string): void {
    writeFileSync(
      join(projectRoot, ".github", "instructions", `${name}.instructions.md`),
      `---\napplyTo: "${applyTo}"\n---\n${body}\n`,
    )
  }

  async function runApplyPatch(
    sessionID: string,
    args: Record<string, unknown>,
    metadata: unknown = {},
  ): Promise<string> {
    callCount += 1
    const output = {
      title: "Success. Updated the following files:",
      output: "Success. Updated the following files:",
      metadata,
    }
    await hook["tool.execute.after"]({ tool: "apply_patch", sessionID, callID: `call_${callCount}`, args }, output)
    return output.output
  }

  beforeEach(() => {
    clearParsedRuleCache()
    testRoot = join(tmpdir(), `rules-injector-apply-patch-${Date.now()}`)
    projectRoot = join(testRoot, "project")
    mkdirSync(join(projectRoot, ".git"), { recursive: true })
    mkdirSync(join(projectRoot, ".github", "instructions"), {
      recursive: true,
    })
    writeRule("ts", "**/*.ts", "ts-rule-body")
    writeRule("md", "**/*.md", "md-rule-body")
    writeRule("sql", "**/*.sql", "sql-rule-body")

    const ctx = {
      directory: projectRoot,
      client: { session: { messages: async () => ({ data: [] }) } },
    } as unknown as PluginInput
    hook = createRulesInjectorHook(ctx, undefined, {
      skipClaudeUserRules: true,
    })
  })

  afterEach(() => {
    clearParsedRuleCache()
    rmSync(testRoot, { recursive: true, force: true })
  })

  it("#given a patch that adds, updates and moves files #when apply_patch completes #then each matched file's rule is injected once", async () => {
    // given
    const patchText = patch(
      "*** Add File: src/new.ts",
      "+export const a = 1;",
      "*** Update File: docs/guide.md",
      "@@",
      "-old",
      "+new",
      "*** Update File: notes/query.txt",
      "*** Move to: db/query.sql",
      "@@",
      " select 1;",
    )

    // when
    const output = await runApplyPatch("ses_multi", { patchText })

    // then
    expect(countOf(output, TS_RULE)).toBe(1)
    expect(countOf(output, MD_RULE)).toBe(1)
    expect(countOf(output, SQL_RULE)).toBe(1)
  })

  it("#given apply_patch metadata lists the files #when apply_patch completes #then the metadata paths are used instead of the patch headers", async () => {
    // given
    const patchText = patch("*** Update File: docs/guide.md", "@@", "-a", "+b")
    const metadata = {
      files: [
        {
          filePath: join(projectRoot, "src", "a.ts"),
          relativePath: "src/a.ts",
          type: "update",
          patch: "",
        },
        {
          filePath: join(projectRoot, "notes", "query.txt"),
          relativePath: "db/query.sql",
          type: "move",
          movePath: join(projectRoot, "db", "query.sql"),
          patch: "",
        },
        {
          filePath: join(projectRoot, "docs", "gone.md"),
          relativePath: "docs/gone.md",
          type: "delete",
          patch: "",
        },
      ],
    }

    // when
    const output = await runApplyPatch("ses_metadata", { patchText }, metadata)

    // then
    expect(countOf(output, TS_RULE)).toBe(1)
    expect(countOf(output, SQL_RULE)).toBe(1)
    expect(output).not.toContain(MD_RULE)
  })

  it("#given a patch that only deletes files #when apply_patch completes #then no rule is injected", async () => {
    // given
    const patchText = patch("*** Delete File: src/old.ts", "*** Delete File: docs/old.md")

    // when
    const output = await runApplyPatch("ses_delete", { patchText })

    // then
    expect(output).toBe("Success. Updated the following files:")
  })

  it("#given a rule was injected for a file #when a second patch touches the same file #then the rule is not repeated", async () => {
    // given
    const patchText = patch("*** Update File: src/a.ts", "@@", "-a", "+b")
    const first = await runApplyPatch("ses_repeat", { patchText })

    // when
    const second = await runApplyPatch("ses_repeat", { patchText })

    // then
    expect(countOf(first, TS_RULE)).toBe(1)
    expect(second).not.toContain(TS_RULE)
  })
})
