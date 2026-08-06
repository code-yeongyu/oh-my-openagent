import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { createAgentControlTools } from "./tools"
import { buildAgentControlMcpEnvironment, runAgentControlMcp } from "./mcp-runtime"
import type { AgentControlRuntimeRequest } from "./types"
import {
  clearAgentControlAgentFromReport,
  hasPendingAgentControlWait,
  resetAgentControlWaitStateForTesting,
} from "./wait-state"

const toolContext = {
  sessionID: "leader-session",
  messageID: "leader-message",
  agent: "lead",
  abort: new AbortController().signal,
}
const originalRole = process.env.AGENT_CONTROL_ROLE

async function execute(tool: ToolDefinition, input: Record<string, unknown>): Promise<string> {
  if (!tool.execute) throw new TypeError("tool execute is required")
  return tool.execute(input, toolContext)
}

afterEach(() => {
  resetAgentControlWaitStateForTesting()
  if (originalRole === undefined) delete process.env.AGENT_CONTROL_ROLE
  else process.env.AGENT_CONTROL_ROLE = originalRole
})

describe("#given the restored Python MCP runtime", () => {
  test("#when a session-owned request starts Python #then exact session identity is forwarded", () => {
    const env = buildAgentControlMcpEnvironment("owner:leader-session", {})
    expect(env.AGENT_CONTROL_OWNER).toBe("owner:leader-session")
    expect(env.AGENT_CONTROL_SESSION_ID).toBe("leader-session")
  })

  test("#when the native facade calls List #then v3 returns its structured ledger result", async () => {
    const project = mkdtempSync(join(tmpdir(), "agentcontrol-facade-"))
    try {
      const output = await runAgentControlMcp({ project, owner: "owner:test", action: "List", arguments: {} })
      expect(JSON.parse(output)).toEqual({ agents: [], status: "OK" })
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})

describe("#given direct AgentControl actions", () => {
  test("#when tools are created #then the exact action surface replaces the generic facade", () => {
    const tools = createAgentControlTools({ directory: "/project" }, async () => "{}")
    expect(Object.keys(tools)).toEqual([
      "Execute", "Explore", "Plan", "Research", "Dispatch",
      "Send", "List", "Collect", "Peek", "Cancel",
    ])
    for (const action of ["Execute", "Explore", "Plan", "Research", "Dispatch"] as const) {
      expect(Object.keys(tools[action].args)).toContain("handoff")
      expect(tools[action].args.handoff?.isOptional()).toBe(false)
    }
  })

  test("#when a worker process creates tools #then AgentControl exposes only Report", () => {
    process.env.AGENT_CONTROL_ROLE = "worker"
    const tools = createAgentControlTools({ directory: "/project" }, async () => "{}")
    expect(Object.keys(tools)).toEqual(["Report"])
  })

  test("#when Explore is accepted #then it fixes the MCP action and direct report delivery", async () => {
    const requests: AgentControlRuntimeRequest[] = []
    const tools = createAgentControlTools({ directory: "/project" }, async (request) => {
      requests.push(request)
      return JSON.stringify({ status: "OK", name: "trace-auth" })
    })

    const output = JSON.parse(await execute(tools.Explore, {
      name: "trace-auth",
      prompt: "trace auth",
      handoff: ".agent-control/handoffs/trace-auth.md",
      breadth: "thorough",
    }))

    expect(requests[0]).toMatchObject({
      action: "Explore",
      arguments: {
        name: "trace-auth",
        prompt: "trace auth",
        handoff: ".agent-control/handoffs/trace-auth.md",
        breadth: "thorough",
      },
    })
    expect(output).toMatchObject({ result_delivery: "direct_to_leader", collect: false, do_not_poll: true })
    expect(hasPendingAgentControlWait(toolContext.sessionID)).toBe(true)
    expect(tools.Explore.description).toContain("expire automatically after five idle minutes")
  })

  test("#when a direct final report arrives #then its Agent wait state is cleared", async () => {
    const tools = createAgentControlTools({ directory: "/project" }, async () => (
      JSON.stringify({ status: "OK", name: "trace-auth" })
    ))
    await execute(tools.Explore, {
      name: "trace-auth",
      prompt: "trace auth",
      handoff: ".agent-control/handoffs/trace-auth.md",
    })

    const cleared = clearAgentControlAgentFromReport(
      toolContext.sessionID,
      "[AGENT_REPORT trace-auth kind=explore] complete",
    )

    expect(cleared).toBe(true)
    expect(hasPendingAgentControlWait(toolContext.sessionID)).toBe(false)
  })

  test("#when Dispatch and Collect complete #then group wait state is cleared", async () => {
    const requests: AgentControlRuntimeRequest[] = []
    const tools = createAgentControlTools({ directory: "/project" }, async (request) => {
      requests.push(request)
      return JSON.stringify({ status: "OK", group: "batch" })
    })

    await execute(tools.Dispatch, {
      template: "work {item}",
      items: ["one"],
      group: "batch",
      handoff: ".agent-control/handoffs/batch.md",
    })
    expect(hasPendingAgentControlWait(toolContext.sessionID)).toBe(true)
    await execute(tools.Collect, { group: "batch" })

    expect(requests[1]?.action).toBe("Collect")
    expect(requests[1]?.arguments).toEqual({ group: "batch", timeout_ms: 0, consume: true })
    expect(hasPendingAgentControlWait(toolContext.sessionID)).toBe(false)
  })

  test("#when every launch action runs #then its handoff path is forwarded unchanged", async () => {
    const requests: AgentControlRuntimeRequest[] = []
    const tools = createAgentControlTools({ directory: "/project" }, async (request) => {
      requests.push(request)
      return JSON.stringify({ status: "OK", name: "worker", group: "batch" })
    })

    for (const action of ["Execute", "Explore", "Plan", "Research"] as const) {
      await execute(tools[action], {
        name: action.toLowerCase(),
        prompt: `${action} task`,
        handoff: `.agent-control/handoffs/${action.toLowerCase()}.md`,
      })
    }
    await execute(tools.Dispatch, {
      template: "work {item}",
      items: ["one"],
      group: "batch",
      handoff: ".agent-control/handoffs/dispatch.md",
    })

    expect(requests.map((request) => request.arguments.handoff)).toEqual([
      ".agent-control/handoffs/execute.md",
      ".agent-control/handoffs/explore.md",
      ".agent-control/handoffs/plan.md",
      ".agent-control/handoffs/research.md",
      ".agent-control/handoffs/dispatch.md",
    ])
  })
})
