import type { BuiltinSkill } from "../types"

export const openfangAgentCreationSkill: BuiltinSkill = {
  name: "openfang-agent-creation",
  description: "Rules and patterns for creating openfang agents correctly. Load when creating, configuring, or debugging openfang agents in the Arise architecture.",
  template: `# Openfang Agent Creation — Learned Patterns

Hard-won rules from building the Arise multi-agent architecture. Follow these to avoid known pitfalls.

---

## agent.toml Structure

\`\`\`toml
name = "my-agent"
version = "0.1.0"
description = "..."
author = "openfang"
module = "builtin:chat"
tags = ["tag1", "tag2"]

# mcp_servers MUST be top-level — NOT under [capabilities]
# Leave empty if server name has multiple parts (e.g. "oh-my-openagent")
# due to BUG-011 in openfang kernel (fixed in raf4q0/openfang@59760e8)
mcp_servers = ["oh-my-openagent"]

[model]
provider = "default"
model = "default"
max_tokens = 8192
temperature = 0.2
system_prompt = """Your system prompt here."""

[[fallback_models]]
provider = "default"
model = "gemini-2.0-flash"
api_key_env = "GEMINI_API_KEY"

[resources]
max_llm_tokens_per_hour = 200000
max_concurrent_tools = 5

[capabilities]
# capabilities.tools is an EXPLICIT ALLOWLIST
# List ALL tools: builtins + MCP tools
# Empty = all tools allowed
tools = [
  "memory_recall",
  "mcp_oh_my_openagent_grep",
  "mcp_oh_my_openagent_glob",
  "mcp_oh_my_openagent_ast_grep_search",
  "mcp_oh_my_openagent_file_read",
  "mcp_oh_my_openagent_file_list"
]
network = []
memory_read = ["*"]
memory_write = []
agent_message = []
shell = []

[autonomous]
max_iterations = 20
\`\`\`

---

## MCP Tool Naming

MCP tools follow this format in capabilities.tools:
\`\`\`
mcp_<normalized_server_name>_<tool_name>
\`\`\`
Where normalized = lowercase + hyphens → underscores.

| Server name | Normalized | Example tool |
|------------|------------|--------------|
| oh-my-openagent | oh_my_openagent | mcp_oh_my_openagent_grep |
| bocha-search | bocha_search | mcp_bocha_search_query |

Available MCP tools from oh-my-openagent:
- mcp_oh_my_openagent_grep
- mcp_oh_my_openagent_glob
- mcp_oh_my_openagent_ast_grep_search
- mcp_oh_my_openagent_file_read
- mcp_oh_my_openagent_file_list
- mcp_oh_my_openagent_file_write  (hephaestus only)

---

## Bedrock Model IDs

ALWAYS use cross-region inference profile IDs:

| Model | Correct ID | Wrong ID |
|-------|-----------|----------|
| Claude Sonnet 4.6 | us.anthropic.claude-sonnet-4-6 | anthropic.claude-sonnet-4-6 |
| Claude Haiku 4.5 | us.anthropic.claude-haiku-4-5-20251001-v1:0 | anthropic.claude-haiku-4-5 |
| Claude Opus 4.6 | us.anthropic.claude-opus-4-6-v1 | anthropic.claude-opus-4-6 |
| Nova Pro | us.amazon.nova-pro-v1:0 | amazon.nova-pro-v1:0 |

Using the wrong ID causes: "on-demand throughput isn't supported for this model"

---

## Spawning Agents

\`\`\`bash
# First spawn
openfang agent spawn ~/.openfang/agents/my-agent/agent.toml

# Update existing agent: just edit agent.toml and restart daemon
# openfang auto-detects TOML changes and updates DB on restart:
# "Agent TOML on disk differs from DB, updating [agent=my-agent]"

# Force recreate (if auto-update fails):
pkill -f 'openfang start'
python3 -c "import sqlite3; c=sqlite3.connect('~/.openfang/data/openfang.db'); c.execute('DELETE FROM agents WHERE name=?', ('my-agent',)); c.commit()"
openfang start
openfang agent spawn ~/.openfang/agents/my-agent/agent.toml
\`\`\`

---

## Diagnosing Tool Problems

\`\`\`bash
# Check tool_count in openfang logs
grep 'tool_count' /tmp/openfang.log | tail -5

# Expected: tool_count=8 (or however many tools the agent has)
# Problem: tool_count=1 or =2 → allowlist issue
# Problem: tool_count=0 → capabilities.tools is empty with no "*"

# If only memory tools show up:
# 1. Check capabilities.tools has explicit MCP tool names
# 2. Check mcp_servers is top-level (not under [capabilities])
# 3. Check MCP server is connected: grep 'MCP server connected' /tmp/openfang.log

# Verify tool calling is working (not hallucination):
# iterations=2+ = real tool calls
# iterations=1 with tool XML in response = hallucination (tools not sent to LLM)
\`\`\`

---

## MCP Server Lifecycle

**Order matters:**
1. Start OpenCode → MCP bridge starts automatically on port 4201
2. Then start openfang → connects to MCP bridge
3. Never start openfang before OpenCode

**If MCP disconnects:** restart openfang (not OpenCode). Openfang doesn't auto-reconnect.

**Verify MCP is connected:**
\`\`\`bash
curl http://localhost:4201/health        # from dev machine
grep 'MCP server connected' /tmp/openfang.log  # tools=6 expected
\`\`\`

---

## Agent Role Guidelines

| Role | Agent | Tools |
|------|-------|-------|
| Search codebase | searcher | grep, glob, ast_grep, file_read, file_list |
| External research | researcher | web_fetch + all search tools |
| Deep analysis (read-only) | reasoner | file_read, file_list, ast_grep |
| Pre-implementation planning | planner | file_read, file_list, ast_grep |
| Review plans/code | reviewer | file_read, file_list, ast_grep |
| Write files + implement | hephaestus | all MCP tools including file_write |

hephaestus is the ONLY agent with file_write. All others are read-only.
`,
}
