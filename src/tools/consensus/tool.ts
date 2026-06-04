import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import type { ConsensusConfig } from "../../config/schema/consensus"
import { runConsensus } from "../../features/consensus"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { isUsableVoterPosition } from "../../features/consensus/types"
import type { ConsensusToolArgs, ConsensusToolResult } from "./types"

const isSubagentSession = (sessionID: string): boolean => subagentSessions.has(sessionID)

const CONSENSUS_TOOL_DESCRIPTION = `Run a multi-lineage consensus debate.

Spawns N voters (default 3) from DIFFERENT model families (Anthropic / OpenAI / Google / open-source like Kimi) in parallel, gives each the same prompt, and returns their positions to YOU. You, the calling model, are the synthesizer. Read each voter's position and decide:
- Do they agree? (consensus reached)
- Do they disagree? (escalate to user with all positions)
- Is one right and others wrong? (pick the strongest case)

This tool is RESTRICTED to the main agent. Subagents cannot invoke it (prevents recursion + cost explosion).

Use cases:
- High-stakes architecture decisions
- Validation of analyzed/extracted data
- Interpreting test output / verifying fixes
- Before bothering the user with a question (ask consensus first whether you can resolve it yourself)

Output: an array of voter positions with {lineage, model, status, text}. Synthesize naturally in your next turn.`

type ConsensusToolDeps = {
  runConsensus: typeof runConsensus
  isSubagentSession: typeof isSubagentSession
}

const defaultDeps: ConsensusToolDeps = { runConsensus, isSubagentSession }

export function createConsensusTool(
  ctx: PluginInput,
  consensusConfig: ConsensusConfig | undefined,
  deps: ConsensusToolDeps = defaultDeps,
): ToolDefinition {
  return tool({
    description: CONSENSUS_TOOL_DESCRIPTION,
    args: {
      prompt: tool.schema.string().describe("The full context + question to send to each voter. Be specific about what you want them to evaluate or decide. Include all the information they need."),
      count: tool.schema.number().int().min(2).max(7).optional().describe("Number of voters (default: 3). Must be between 2 and 7. Each voter is a separate LLM call."),
      caller_model: tool.schema.string().optional().describe("Your own model id (e.g., 'claude-opus-4-7'). If provided, voters will be picked from DIFFERENT lineages than yours."),
      exclude_lineages: tool.schema.array(tool.schema.string()).optional().describe("Additional lineage families to exclude from voters (e.g., ['claude-opus', 'gpt']). Useful when you want to force specific lineage diversity."),
    },
    async execute(args: ConsensusToolArgs, toolContext) {
      if (deps.isSubagentSession(toolContext.sessionID)) {
        const message = "consensus is restricted to the main agent. Subagents cannot invoke it (prevents recursion + cost explosion). If you need agent ensemble, do it from the main session."
        log(`[consensus_tool] rejected for subagent session=${toolContext.sessionID}`)
        return message
      }

      if (!args.prompt || args.prompt.trim().length === 0) {
        return "consensus tool requires a non-empty `prompt` argument"
      }

      log(`[consensus_tool] running; caller=${args.caller_model ?? "unknown"} count=${args.count ?? 3}`)

      const parentSession = await ctx.client.session.get({
        path: { id: toolContext.sessionID },
      }).catch((error) => {
        log(`[consensus_tool] failed to resolve parent session directory; using tool context directory`, error)
        return null
      })
      const parentDirectory = parentSession?.data?.directory ?? toolContext.directory ?? ctx.directory

      const result = await deps.runConsensus(ctx, {
        prompt: args.prompt,
        callerModel: args.caller_model,
        count: args.count,
        triggerType: "explicit",
        parentSessionID: toolContext.sessionID,
        parentDirectory,
        excludeLineages: args.exclude_lineages,
      }, consensusConfig)

      const okCount = result.voters.filter(isUsableVoterPosition).length
      const ok = okCount > 0
      const toolResult: ConsensusToolResult = {
        ok,
        advisoryOnly: result.advisoryOnly,
        callerLineage: result.callerLineage,
        callerModel: result.callerModel,
        voters: result.voters.map(v => ({
          lineage: v.lineage,
          model: v.model,
          status: v.status,
          text: v.text,
          durationMs: v.durationMs,
          errorMessage: v.errorMessage,
        })),
        totalDurationMs: result.totalDurationMs,
        guidanceForSynthesizer: buildSynthesizerGuidance(okCount, result.advisoryOnly),
      }

      return JSON.stringify(toolResult, null, 2)
    },
  })
}

function buildSynthesizerGuidance(okVoterCount: number, advisoryOnly: boolean): string {
  if (okVoterCount === 0) {
    return "No voters returned a usable position (no connected providers resolved, or all errored/timed out). Treat this as no consensus signal and fall back to your own judgment or ask the user."
  }
  if (advisoryOnly) {
    return `Only ${okVoterCount} voter returned a position, so this is an ADVISORY second opinion, not a true multi-lineage consensus. Weigh it as one additional perspective; do not treat single-voter agreement as consensus. For a stronger signal, more providers need to be connected.`
  }
  return `You now have ${okVoterCount} voter positions from different model families. Read each one. Your job as the synthesizer:\n1. Identify points of agreement (consensus signal)\n2. Identify points of disagreement (uncertainty signal)\n3. If voters agree on the answer: proceed with the agreed answer\n4. If voters disagree materially: escalate to the user with all positions presented\n5. Never silently pick one position when others contradict it - that throws away the diversity signal`
}
