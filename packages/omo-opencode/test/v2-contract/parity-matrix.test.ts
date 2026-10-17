/**
 * Runtime parity matrix — automated behaviour checks for the V2 port.
 *
 * Agreed shape in code-yeongyu/oh-my-openagent#9389: each row of the
 * 25-row parity matrix is a behaviour check that runs in CI. Rows whose
 * subsystem is not yet ported are `test.todo` entries and flip to active
 * assertions in the corresponding subsystem PR.
 *
 * Source matrix with harness evidence: docs/parity-matrix.md on the
 * reference fork (fazulfi/omo-v2, branch port/v2).
 */
import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { omoV2Plugin } from "../../src/v2"

describe("V2 parity matrix — scaffold slice (live rows)", () => {
  test("row: plugin load (dual-host export)", () => {
    expect(omoV2Plugin.id).toBe("oh-my-openagent")
    expect(typeof omoV2Plugin.setup).toBe("function")
  })

  test("row: bootstrap RPC omo.status", async () => {
    const registered: Array<{ id: string; handler: () => Promise<unknown> }> = []
    const ctx = {
      location: { directory: os.tmpdir() },
      rpc: {
        register: (
          definition: { id: string; methods: Record<string, unknown> },
          handlers: Record<string, () => Promise<unknown>>,
        ) => {
          for (const method of Object.keys(definition.methods)) {
            registered.push({ id: `${definition.id}.${method}`, handler: handlers[method] })
          }
        },
      },
      // Slice 2 registers tools/hooks inside setup; stub the domains the
      // scaffold row does not exercise.
      tool: {
        transform: () => Promise.resolve(),
        hook: () => Promise.resolve(),
      },
      session: { hook: () => Promise.resolve() },
      shell: { hook: () => Promise.resolve() },
    }
    await omoV2Plugin.setup(ctx as never)
    const status = registered.find((r) => r.id === "omo.status")
    expect(status).toBeDefined()
    expect(await status!.handler()).toEqual({ ok: true, stage: "bootstrap" })
  })

  test("row: V1 host still loads the V1 entry unchanged", async () => {
    const v1 = await import("../../src/index")
    expect(typeof v1.default).toBe("object")
    expect(typeof v1.default.server).toBe("function")
    expect(typeof v1.omoPlugin).toBe("function")
    // The V1 module graph must not reach the V2 entry: the default export
    // is a V1 PluginModule, which has no `setup` key.
    expect("setup" in v1.default).toBe(false)
  })
})

describe("V2 parity matrix — tools+hooks slice (live rows)", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-v2-tools-parity-"))
  fs.writeFileSync(path.join(tmpRoot, "fixture-parity-needle.txt"), "parity-needle-content")

  type ToolDef = {
    name: string
    execute: (input: never) => Promise<{ content: string }>
  }
  type HookEntry = {
    domain: "tool" | "session" | "shell"
    name: string
    fn: (input: Record<string, unknown>) => unknown
  }

  function makeToolsCtx() {
    const toolDefs: ToolDef[] = []
    const hooks: HookEntry[] = []
    const rpcIds: string[] = []
    const ctx = {
      location: { directory: tmpRoot },
      rpc: {
        register: (definition: { id: string; methods: Record<string, unknown> }) => {
          rpcIds.push(definition.id)
        },
      },
      tool: {
        transform: (
          editorFn: (editor: { add: (info: ToolDef) => void }) => void,
        ) => {
          editorFn({ add: (info: ToolDef) => toolDefs.push(info) })
          return Promise.resolve()
        },
        hook: (name: string, fn: HookEntry["fn"]) => {
          hooks.push({ domain: "tool", name, fn })
          return Promise.resolve()
        },
      },
      session: {
        hook: (name: string, fn: HookEntry["fn"]) => {
          hooks.push({ domain: "session", name, fn })
          return Promise.resolve()
        },
      },
      shell: {
        hook: (name: string, fn: HookEntry["fn"]) => {
          hooks.push({ domain: "shell", name, fn })
          return Promise.resolve()
        },
      },
    }
    return { ctx, toolDefs, hooks, rpcIds }
  }

  test("row: tools: glob", async () => {
    const { ctx, toolDefs } = makeToolsCtx()
    await omoV2Plugin.setup(ctx as never)
    const glob = toolDefs.find((t) => t.name === "glob")
    expect(glob).toBeDefined()
    const result = await glob!.execute({ pattern: "*.txt" } as never)
    expect(result.content).toContain("fixture-parity-needle.txt")
  })

  test("row: tools: grep", async () => {
    const { ctx, toolDefs } = makeToolsCtx()
    await omoV2Plugin.setup(ctx as never)
    const grep = toolDefs.find((t) => t.name === "grep")
    expect(grep).toBeDefined()
    const result = await grep!.execute({ pattern: "parity-needle-content" } as never)
    expect(result.content).toContain("fixture-parity-needle.txt")
  })

  test("row: hooks: tool.execute.before/after", async () => {
    const { ctx, hooks } = makeToolsCtx()
    await omoV2Plugin.setup(ctx as never)
    const before = hooks.find((h) => h.domain === "tool" && h.name === "execute.before")
    const after = hooks.find((h) => h.domain === "tool" && h.name === "execute.after")
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    // V1 parity (#2697): strip a stray `mcp_` prefix from the tool name.
    const input: Record<string, unknown> = { tool: "mcp_legacy" }
    before!.fn(input)
    expect(input.tool).toBe("legacy")
  })

  test("row: hooks: session compaction", async () => {
    const { ctx, hooks } = makeToolsCtx()
    await omoV2Plugin.setup(ctx as never)
    const compaction = hooks.find((h) => h.domain === "session" && h.name === "compaction")
    expect(compaction).toBeDefined()
  })

  test("row: hooks: shell create.before", async () => {
    const { ctx, hooks } = makeToolsCtx()
    await omoV2Plugin.setup(ctx as never)
    const createBefore = hooks.find((h) => h.domain === "shell" && h.name === "create.before")
    expect(createBefore).toBeDefined()
    // V1 parity: null bytes are stripped from shell commands.
    const input: Record<string, unknown> = { command: "echo\x00clean" }
    createBefore!.fn(input)
    expect(input.command).toBe("echoclean")
  })
})

describe("V2 parity matrix — subsystem rows (pending, flip in subsystem PRs)", () => {
  test.todo("row: client/session/event surface (PR: client)")
  test.todo("row: agents: listing (10 OMC agents) (PR: agents)")
  test.todo("row: agents: dispatch roundtrip (PR: agents)")
  test.todo("row: agents: unknown agent -> clear error (PR: agents)")
  test.todo("row: agents: builtin build/plan demoted, default sisyphus (PR: agents)")
  test.todo("row: background task: spawn -> collect (PR: orchestration)")
  test.todo("row: background task: error path does not hang (PR: orchestration)")
  test.todo("row: todos: write/read roundtrip (PR: orchestration)")
  test.todo("row: MCP: builtin server injection (PR: mcp)")
  test.todo("row: MCP: injected server visible via tools/list (PR: mcp)")
  test.todo("row: skills: location fallback listing (PR: skills)")
  test.todo("row: skills: skills callable from registered agent surface (PR: skills)")
  test.todo("row: config: V1 config normalizes without rewrite (PR: config)")
  test.todo("row: TUI: registerTui slot claims + keymap (PR: tui)")
  test.todo("row: companion: DCP 3.2.0 co-loads, no conflicts (PR: integration)")
  test.todo("row: companion: tokenscope co-loads, no conflicts (PR: integration)")
  test.todo("row: static gates: zero @opencode-ai/* in v2 surface, exact 2.0.20 pins (PR: gates)")
})
