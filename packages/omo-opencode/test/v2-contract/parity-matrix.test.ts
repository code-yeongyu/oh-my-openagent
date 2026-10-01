/**
 * Runtime parity matrix — automated behaviour checks for the V2 port.
 *
 * Agreed shape in code-yeongyu/oh-my-openagent#9389: each row of the
 * parity matrix is a behaviour check that runs in CI. Rows whose
 * subsystem is not yet ported are tracked here as pending and flip to
 * active assertions in the corresponding subsystem PR.
 *
 * Source matrix with harness evidence: docs/parity-matrix.md on the
 * reference fork (fazulfi/omo-v2, branch port/v2).
 */
import { describe, expect, test } from "bun:test"

import omoV2Plugin, { omoV2 } from "../src/index"

const matrix = [
  { feature: "plugin load (dual-host export)", status: "pass" },
  { feature: "bootstrap RPC omo.status", status: "pass" },
  { feature: "tools: glob", status: "pending", pr: "tools+hooks" },
  { feature: "tools: grep", status: "pending", pr: "tools+hooks" },
  { feature: "hooks: tool.execute.before/after", status: "pending", pr: "tools+hooks" },
  { feature: "hooks: session compaction", status: "pending", pr: "tools+hooks" },
  { feature: "hooks: shell create.before", status: "pending", pr: "tools+hooks" },
  { feature: "client/session/event surface", status: "pending", pr: "client" },
  { feature: "agents: listing (10 OMC agents)", status: "pending", pr: "agents" },
  { feature: "agents: dispatch roundtrip", status: "pending", pr: "agents" },
  { feature: "agents: unknown agent -> clear error", status: "pending", pr: "agents" },
  { feature: "agents: builtin build/plan demoted, default sisyphus", status: "pending", pr: "agents" },
  { feature: "background task: spawn -> collect", status: "pending", pr: "orchestration" },
  { feature: "background task: error path does not hang", status: "pending", pr: "orchestration" },
  { feature: "todos: write/read roundtrip", status: "pending", pr: "orchestration" },
  { feature: "MCP: builtin server injection", status: "pending", pr: "mcp" },
  { feature: "skills: location fallback listing", status: "pending", pr: "skills" },
  { feature: "config: V1 config normalizes without rewrite", status: "pending", pr: "config" },
  { feature: "TUI: registerTui slot claims + keymap", status: "pending", pr: "tui" },
  { feature: "companion: DCP 3.2.0 co-loads (no conflicts)", status: "pending", pr: "integration" },
  { feature: "companion: tokenscope co-loads (no conflicts)", status: "pending", pr: "integration" },
] as const

describe("V2 parity matrix", () => {
  test("row: plugin load (dual-host export)", () => {
    expect(omoV2Plugin.id).toBe("oh-my-openagent")
    expect(typeof omoV2Plugin.setup).toBe("function")
    expect(omoV2).toBe(omoV2Plugin)
  })

  test("row: bootstrap RPC omo.status", async () => {
    const registered: string[] = []
    const ctx = {
      rpc: {
        register: (definition: { id: string; methods: Record<string, unknown> }, handlers: Record<string, () => Promise<unknown>>) => {
          for (const method of Object.keys(definition.methods)) {
            registered.push(`${definition.id}.${method}`)
            void handlers[method]
          }
        },
      },
    }
    await omoV2Plugin.setup(ctx as never)
    expect(registered).toContain("omo.status")
  })

  test("matrix bookkeeping: every row is pass or mapped to a subsystem PR", () => {
    for (const row of matrix) {
      if (row.status === "pending") {
        expect(typeof (row as { pr?: string }).pr).toBe("string")
      }
    }
  })
})
