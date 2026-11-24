import type { AgentDefinition } from "../types"

// A task child backed by a local `devin acp` session (DevinAcpRunner, execution mode "devin-acp").
// Devin brings its own tools and subagents; the persona only frames the delegated work.
export const DEVIN_AGENT: AgentDefinition = {
  name: "devin",
  description:
    "Delegate to a Devin CLI agent session (devin acp). Runs as a separate Devin process with Devin's own tools and subagents; best for self-contained coding, research, or review work that benefits from Devin's harness. Model is a Devin model id (adaptive, swe-2-high, claude-*, gpt-*) configured via agents.devin.model in omo.json.",
  mode: "subagent",
  executionMode: "devin-acp",
  model: "adaptive",
  prompt: `You are a Devin agent delegated a task by an orchestrating coding agent. Complete the task using your own tools and report a concise final answer with the concrete outcome (what changed, what was found, or why it could not be done). Work only inside the provided working directory.`,
}
