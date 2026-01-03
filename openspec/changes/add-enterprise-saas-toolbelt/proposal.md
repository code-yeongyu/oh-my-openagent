## Why

Enterprise engineering teams struggle with fragmented tooling and lost organizational knowledge. Engineers context-switch between 10+ tools daily (GitHub, Jira, Datadog, Slack, etc.), and critical decisions live in chat history, lost when sessions end. AI coding assistants lack organizational context, making the same mistakes repeatedly because they don't know company policies, architectural decisions, or team conventions.

This proposal extends oh-my-opencode into a comprehensive enterprise SaaS engineer toolbelt with:
1. **Knowledge Governance** - Git-like system for organizational knowledge
2. **MCP Integration** - Connect to enterprise tools (Datadog, Jira, AWS, etc.)
3. **Skills Framework** - 16 specialized skills for engineering workflows
4. **Agent Orchestration** - 11 new agents for domain expertise

## What Changes

### Phase 0: Foundation (Week 1-2)
- **ADDED** Knowledge Repository feature with immutable commits
- **ADDED** Mem0 MCP adapter for multi-layer AI memory
- **ADDED** `/knowledge` skill for querying and proposing knowledge
- **ADDED** Knowledge Monitor hook for session conflict detection
- **ADDED** `knowledge-curator` agent for knowledge lifecycle

### Phase 1: Debugging (Week 3-4)
- **ADDED** `/debug` skill with root cause tracing
- **ADDED** Datadog MCP integration (enterprise)
- **ADDED** Sentry MCP integration (free tier)
- **ADDED** `debugger` agent for systematic debugging

### Phase 2: Deployment (Week 5-6)
- **ADDED** `/deploy` skill with release orchestration
- **ADDED** AWS MCP integration (enterprise)
- **ADDED** Terraform MCP integration
- **ADDED** `devops-engineer` agent

### Phase 3: Project Management (Week 7-8)
- **ADDED** Jira/Confluence integration via mcp-atlassian
- **ADDED** Linear MCP integration (free alternative)
- **MODIFIED** `/knowledge` skill to sync with Confluence

### Phase 4: Testing (Week 9-10)
- **ADDED** `/test` skill with pairwise generation
- **ADDED** Playwright MCP integration
- **ADDED** `test-engineer` agent

### Phase 5: Code Review (Week 11-12)
- **ADDED** `/review` skill with evaluation harness
- **ADDED** GitHub MCP integration enhancements
- **ADDED** `code-reviewer` agent

### Phase 6-8: Incident, Security, Advanced (Week 13-18)
- **ADDED** `/incident`, `/security`, `/oncall` skills
- **ADDED** Grafana OnCall MCP (free PagerDuty alternative)
- **ADDED** Semgrep MCP integration
- **ADDED** Custom MCPs: Honeycomb, Snyk, Cypress, Vault

## Impact

### Affected Specs
- `knowledge-governance` - New capability
- `mcp-integration` - New capability
- `skills-framework` - New capability
- `agents-orchestration` - New capability
- `enterprise-tools` - New capability

### Affected Code
- `src/features/knowledge-repo/` - New feature
- `src/features/mem0-memory/` - New feature
- `src/features/builtin-skills/` - Extended with 16 skills
- `src/hooks/knowledge-monitor/` - New hook
- `src/tools/knowledge/` - New tools
- `src/agents/` - 11 new agents
- `src/mcp/` - 20+ MCP configurations

### Breaking Changes
- None (additive changes only)

### Migration
- Existing oh-my-opencode users: `bun run build` and restart
- New users: Standard installation + enterprise tool configuration

### Risk Assessment
- **HIGH**: MCP ecosystem maturity varies by category
- **MEDIUM**: Enterprise tool authentication complexity
- **LOW**: Knowledge governance adoption curve
