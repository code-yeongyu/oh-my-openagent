import type { BuiltinSkill } from "../types"

export const mcbSkill: BuiltinSkill = {
  name: "oc-mcb",
  description:
    "MCB (Memory Context Browser) integration for semantic code search, session management, and validation. Provides persistent context across sessions via local MCB binary.",
  template: `# MCB Integration

MCB provides semantic code search, memory persistence, and code validation via a local MCP server.

## Available Tools

| Tool | Purpose |
|------|---------|
| \`mcp_mcb_search\` | Semantic code search across indexed repositories |
| \`mcp_mcb_memory\` | Store and retrieve observations, learnings, and session data |
| \`mcp_mcb_index\` | Index codebase for semantic search |
| \`mcp_mcb_validate\` | Code quality validation against configurable rules |
| \`mcp_mcb_vcs\` | Git-aware context: branch comparison, impact analysis |

## Usage

Search code semantically:
\`\`\`
mcp_mcb_search(resource="code", query="authentication middleware")
\`\`\`

Store an observation:
\`\`\`
mcp_mcb_memory(action="store", resource="observation", data={...})
\`\`\`

Index a repository:
\`\`\`
mcp_mcb_index(action="start", path="/path/to/repo", collection="my-project")
\`\`\``,
  mcpConfig: {
    mcb: {
      command: "mcb",
      args: ["serve"],
    },
  },
}
