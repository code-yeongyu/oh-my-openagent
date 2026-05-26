import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  readAllFacts,
  readFact,
  getFactStats,
  proposeFact,
  listProposals,
  approveProposal,
  rejectProposal,
} from "./storage"

export function createProjectMemoryTools(directory: string): Record<string, ToolDefinition> {
  const memory_facts: ToolDefinition = tool({
    description:
      "Read project memory facts — verified long-term knowledge about this project. " +
      "Without arguments, lists all facts files with line counts. " +
      "With a name, shows the contents of that specific facts file. " +
      "Facts take priority over conversation history and agent reasoning. " +
      "If you find a contradiction with a fact, raise it to the user — do not silently override.",
    args: {
      name: tool.schema
        .string()
        .optional()
        .describe("Facts file name (e.g. 'architecture', 'invariants'). Omit to list all."),
      stats: tool.schema
        .boolean()
        .optional()
        .describe("Show line counts and budget stats"),
    },
    execute: async (args) => {
      if (args.name) {
        const content = readFact(directory, args.name)
        if (content === null) {
          return `[ERROR] Facts file '${args.name}' not found. Use memory_facts (no args) to list available files.`
        }
        return content
      }

      const facts = readAllFacts(directory)
      if (facts.length === 0) {
        return "No facts files found in .omo/memory/facts/. Use memory_propose_fact to propose new facts."
      }

      if (args.stats) {
        const { totalLines } = getFactStats(directory)
        const lines = facts.map(
          (f) => `- ${f.name}.md (${f.content.split("\n").length} lines)`,
        )
        return `Facts files (${facts.length}, ${totalLines} total lines):\n${lines.join("\n")}`
      }

      return `Available facts files:\n${facts.map((f) => `- ${f.name}`).join("\n")}`
    },
  })

  const memory_propose_fact: ToolDefinition = tool({
    description:
      "Propose a new fact to the project memory ledger. The proposal requires human approval " +
      "before it becomes a permanent fact. Before proposing, verify ALL conditions: " +
      "(1) information is verified, not a hypothesis; " +
      "(2) future sessions will repeatedly need it; " +
      "(3) it won't become stale quickly; " +
      "(4) no equivalent fact already exists.",
    args: {
      file: tool.schema
        .string()
        .describe("Target facts file (e.g. 'architecture', 'pitfalls', 'invariants')"),
      content: tool.schema.string().describe("The fact text to add"),
      reason: tool.schema.string().describe("Why this qualifies as a long-term fact"),
      action: tool.schema
        .enum(["append", "create"])
        .optional()
        .describe("'append' (default) to add to existing file, 'create' for a new file"),
    },
    execute: async (args) => {
      const proposal = proposeFact(directory, {
        file: args.file,
        content: args.content,
        reason: args.reason,
        action: args.action as "append" | "create" | undefined,
      })
      return (
        `Fact proposed (ID: ${proposal.id}).\n` +
        `Target: .omo/memory/facts/${args.file}.md\n` +
        `Action: ${proposal.action}\n` +
        `Reason: ${args.reason}\n\n` +
        `Awaiting human approval. The user can run:\n` +
        `  omo-memory review ${proposal.id} --approve\n` +
        `  omo-memory review ${proposal.id} --reject`
      )
    },
  })

  const memory_proposals: ToolDefinition = tool({
    description:
      "List pending fact proposals awaiting human approval. " +
      "Use this to check if there are proposals that need review.",
    args: {},
    execute: async () => {
      const proposals = listProposals(directory)
      if (proposals.length === 0) {
        return "No pending proposals."
      }

      const lines = proposals.map(
        (p) =>
          `- [${p.id}] → ${p.file}.md (${p.action})\n  Content: ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}\n  Reason: ${p.reason}\n  Proposed: ${p.timestamp}`,
      )
      return `Pending proposals (${proposals.length}):\n\n${lines.join("\n\n")}`
    },
  })

  const memory_approve: ToolDefinition = tool({
    description:
      "Approve a pending fact proposal, writing it to the facts ledger. " +
      "Only use this when explicitly instructed by the user to approve a proposal.",
    args: {
      id: tool.schema.string().describe("The proposal ID to approve"),
    },
    execute: async (args) => {
      const result = approveProposal(directory, args.id)
      if (!result.ok) {
        return `[ERROR] ${result.error}`
      }
      return `Proposal ${args.id} approved and written to facts.`
    },
  })

  const memory_reject: ToolDefinition = tool({
    description:
      "Reject a pending fact proposal, removing it without writing to facts. " +
      "Only use this when explicitly instructed by the user to reject a proposal.",
    args: {
      id: tool.schema.string().describe("The proposal ID to reject"),
    },
    execute: async (args) => {
      const result = rejectProposal(directory, args.id)
      if (!result.ok) {
        return `[ERROR] ${result.error}`
      }
      return `Proposal ${args.id} rejected and removed.`
    },
  })

  return {
    memory_facts,
    memory_propose_fact,
    memory_proposals,
    memory_approve,
    memory_reject,
  }
}
