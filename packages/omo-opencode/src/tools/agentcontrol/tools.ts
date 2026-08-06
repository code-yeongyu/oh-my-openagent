import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { runAgentControlMcp } from "./mcp-runtime"
import type { AgentControlAction, AgentControlRuntime } from "./types"
import {
  clearAgentControlAgent,
  clearAgentControlDispatch,
  markAgentControlAgent,
  markAgentControlDispatch,
} from "./wait-state"

type ToolContext = Parameters<NonNullable<ToolDefinition["execute"]>>[1]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function successful(output: string): boolean {
  try {
    const parsed: unknown = JSON.parse(output)
    return isRecord(parsed) && parsed.status === "OK"
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}

function withGuidance(output: string, guidance: Readonly<Record<string, unknown>>): string {
  try {
    const parsed: unknown = JSON.parse(output)
    return isRecord(parsed) && parsed.status === "OK"
      ? JSON.stringify({ ...parsed, ...guidance })
      : output
  } catch (error) {
    if (error instanceof SyntaxError) return output
    throw error
  }
}

function createCaller(
  directory: string,
  runtime: AgentControlRuntime,
): (action: AgentControlAction, args: Record<string, unknown>, context: ToolContext) => Promise<string> {
  return (action, args, context) => runtime({
    project: directory,
    owner: `owner:${context.sessionID}`,
    action,
    arguments: args,
    abort: context.abort,
  })
}

function createAgentAction(
  action: "Execute" | "Explore" | "Plan" | "Research",
  description: string,
  call: ReturnType<typeof createCaller>,
): ToolDefinition {
  const args = {
    name: tool.schema.string(),
    prompt: tool.schema.string(),
    target: tool.schema.string().optional(),
    ...(action === "Execute" ? {
      isolation: tool.schema.literal("worktree").optional(),
      base: tool.schema.string().optional(),
    } : {}),
    ...(action === "Explore" ? {
      breadth: tool.schema.enum(["quick", "medium", "thorough"]).optional(),
    } : {}),
  }
  return tool({
    description: `${description} Launch is asynchronous; its Report arrives directly. Do not Collect, poll, or Cancel after completion; final Agents expire automatically after five idle minutes.`,
    args,
    async execute(input, context): Promise<string> {
      const output = await call(action, input, context)
      if (successful(output)) markAgentControlAgent(context.sessionID, input.name)
      return withGuidance(output, {
        result_delivery: "direct_to_leader",
        await_event: "AGENT_REPORT",
        collect: false,
        do_not_poll: true,
      })
    },
  })
}

export function createAgentControlTools(
  ctx: Pick<PluginInput, "directory">,
  runtime: AgentControlRuntime = runAgentControlMcp,
): Record<string, ToolDefinition> {
  const call = createCaller(ctx.directory, runtime)
  if (process.env.AGENT_CONTROL_ROLE === "worker") {
    return {
      Report: tool({
        description: "Return one summary and optional final Markdown details to the leader.",
        args: {
          summary: tool.schema.string().min(1).max(600),
          details: tool.schema.string().optional(),
          final: tool.schema.boolean().optional(),
        },
        execute: (input, context) => call("Report", input, context),
      }),
    }
  }

  return {
    Execute: createAgentAction("Execute", "Execute one bounded implementation or verification task.", call),
    Explore: createAgentAction("Explore", "Explore local files, symbols, references, and execution paths read-only.", call),
    Plan: createAgentAction("Plan", "Plan the smallest implementation grounded in inspected local code read-only.", call),
    Research: createAgentAction("Research", "Research current external contracts from authoritative sources read-only.", call),
    Dispatch: tool({
      description: "Fan one {item} workflow contract over a grouped paneless queue. Wait for a real group wake, then Collect once.",
      args: {
        template: tool.schema.string(),
        items: tool.schema.array(tool.schema.string()).min(1).max(1000),
        group: tool.schema.string().min(1).max(64),
        isolation: tool.schema.literal("worktree").optional(),
        base: tool.schema.string().optional(),
      },
      async execute(input, context): Promise<string> {
        const output = await call("Dispatch", input, context)
        if (successful(output)) markAgentControlDispatch(context.sessionID, input.group)
        return withGuidance(output, {
          result_delivery: "ledger_after_group_wake",
          collect_group: input.group,
          do_not_poll: true,
        })
      },
    }),
    Send: tool({
      description: "Queue a follow-up to an active interactive Agent without interrupting its turn. Final-reported Agents reject follow-ups and expire automatically.",
      args: { target: tool.schema.string(), message: tool.schema.string() },
      execute: (input, context) => call("Send", input, context),
    }),
    List: tool({
      description: "List owned Agent and Dispatch lifecycle state. This is diagnostic, not progress polling.",
      args: { all_owners: tool.schema.boolean().optional() },
      execute: (input, context) => call("List", input, context),
    }),
    Collect: tool({
      description: "Consume one Dispatch group after its actual completion/dead/stopped wake. Never use for Agent actions.",
      args: { group: tool.schema.string().min(1) },
      async execute(input, context): Promise<string> {
        const output = await call("Collect", { group: input.group, timeout_ms: 0, consume: true }, context)
        if (successful(output)) clearAgentControlDispatch(context.sessionID, input.group)
        return output
      },
    }),
    Peek: tool({
      description: "Read recent Agent terminal or Dispatch logs for diagnosis, not progress polling.",
      args: { target: tool.schema.string(), lines: tool.schema.number().int().min(1).max(200).optional() },
      execute: (input, context) => call("Peek", input, context),
    }),
    Cancel: tool({
      description: "Stop an owned Agent or verified Dispatch process.",
      args: { target: tool.schema.string(), keep_worktree: tool.schema.boolean().optional() },
      async execute(input, context): Promise<string> {
        const output = await call("Cancel", input, context)
        if (successful(output)) clearAgentControlAgent(context.sessionID, input.target)
        return output
      },
    }),
  }
}
