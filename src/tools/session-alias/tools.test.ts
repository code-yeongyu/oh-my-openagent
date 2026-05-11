import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createSessionAliasTools } from "./tools"

function makeCtx(directory: string): PluginInput {
  return {
    directory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $: (() => ({})) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "session-alias-tools-test-"))
}

async function exec(
  tool: { execute: (args: unknown, context: unknown) => unknown },
  args: unknown,
): Promise<string> {
  const result = await tool.execute(args, {})
  return typeof result === "string" ? result : JSON.stringify(result)
}

describe("createSessionAliasTools", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("session_alias_create succeeds with existence check off", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => false,
    })
    const out = await exec(tools.session_alias_create, {
      alias: "work",
      session_id: "ses_aaa11111",
      skip_existence_check: true,
    })
    expect(out).toContain("Created alias")
    expect(out).toContain("work")
  })

  test("session_alias_create rejects nonexistent session by default", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => false,
    })
    const out = await exec(tools.session_alias_create, {
      alias: "work",
      session_id: "ses_aaa11111",
    })
    expect(out).toContain("does not exist")
  })

  test("session_alias_create succeeds when session exists", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => true,
    })
    const out = await exec(tools.session_alias_create, {
      alias: "work",
      session_id: "ses_aaa11111",
    })
    expect(out).toContain("Created alias")
  })

  test("session_alias_list shows created aliases", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => true,
    })
    await exec(tools.session_alias_create, { alias: "a", session_id: "ses_aaa11111" })
    await exec(tools.session_alias_create, { alias: "b", session_id: "ses_bbb22222" })
    const out = await exec(tools.session_alias_list, {})
    expect(out).toContain("`a`")
    expect(out).toContain("`b`")
    expect(out).toContain("ses_aaa11111")
  })

  test("session_alias_list reports empty state", async () => {
    const tools = createSessionAliasTools(makeCtx(dir))
    const out = await exec(tools.session_alias_list, {})
    expect(out).toContain("No session aliases")
  })

  test("session_alias_delete removes an alias", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => true,
    })
    await exec(tools.session_alias_create, { alias: "kill", session_id: "ses_aaa11111" })
    const out = await exec(tools.session_alias_delete, { alias: "kill" })
    expect(out).toContain("Deleted alias")
    const list = await exec(tools.session_alias_list, {})
    expect(list).toContain("No session aliases")
  })

  test("session_alias_delete reports not_found for unknown alias", async () => {
    const tools = createSessionAliasTools(makeCtx(dir))
    const out = await exec(tools.session_alias_delete, { alias: "ghost" })
    expect(out).toContain("not found")
  })

  test("session_alias_create overwrite=true replaces existing", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => true,
    })
    await exec(tools.session_alias_create, { alias: "w", session_id: "ses_aaa11111" })
    const out = await exec(tools.session_alias_create, {
      alias: "w",
      session_id: "ses_bbb22222",
      overwrite: true,
    })
    expect(out).toContain("Replaced alias")
    expect(out).toContain("ses_bbb22222")
  })

  test("session_alias_create surface validation errors", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => true,
    })
    const out = await exec(tools.session_alias_create, {
      alias: "ses_evil",
      session_id: "ses_aaa11111",
    })
    expect(out).toContain("Error")
    expect(out.toLowerCase()).toContain("reserved")
  })

  test("session_alias_create surfaces existence-check failures gracefully", async () => {
    const tools = createSessionAliasTools(makeCtx(dir), {
      sessionExists: async () => {
        throw new Error("storage exploded")
      },
    })
    // Existence check throws → caught and treated as "does not exist"
    const out = await exec(tools.session_alias_create, {
      alias: "w",
      session_id: "ses_aaa11111",
    })
    expect(out).toContain("does not exist")
  })
})
