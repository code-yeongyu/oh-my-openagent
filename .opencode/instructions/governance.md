# Global Governance Rules

> These rules apply to ALL agents in ALL conversations.

## Agent Organization Convention

### Standard Agent Location

All agents MUST be located in `.opencode/agent/` using a **flat structure**:

```
.opencode/agent/
├── orchestrator.md           # Entry point agent
├── context-steward.md        # Governance: path validation
├── historian.md              # Governance: audit trail
├── product-strategist.md     # Planning: requirements
├── strategic-architect.md    # Planning: architecture
├── linear-coordinator.md     # Planning: Linear integration
├── implementation-specialist.md  # Implementation: features
├── quick-fixer.md            # Implementation: hotfixes
├── code-reviewer.md          # Quality: reviews
├── test-engineer.md          # Quality: testing
├── ... (other agents)
└── README.md                 # Agent index
```

### Agent Categories (Logical Grouping)

Agents are logically grouped by category for documentation purposes, but files remain in flat structure:

| Category | Agents | Purpose |
|----------|--------|---------|
| **Governance** | context-steward, historian, agent-auditor, meta-improvement-analyst, mode-auditor | Project organization, audit trail |
| **Planning** | product-strategist, strategic-architect, linear-coordinator | Requirements, architecture |
| **Implementation** | implementation-specialist, quick-fixer, devops-specialist | Code, deployment |
| **Quality** | code-reviewer, test-engineer, documentation-master, chat-auditor | Reviews, testing, docs |
| **Specialized** | rag-architect, ml-engineer, ai-engineer-agentic, web-design-guru, project-guru, brd-creator, rule-engineer, research, agent-engineer | Domain expertise |

### Agent File Structure

Each agent file MUST:
- Be a Markdown file (`.md`) with YAML frontmatter
- Include required frontmatter fields:
  - `description`: Brief purpose (1-2 sentences)
  - `mode`: `all` or `subagent`
  - `model`: Model identifier
  - `tools`: Object with tool permissions
- Use kebab-case naming (e.g., `context-steward.md`)

### Deprecated Locations

⚠️ **DO NOT** create agents in these deprecated locations:
- `.rulesync/subagents/` (legacy location, migrated to `.opencode/agent/`)
- `.rulesync/rules/` (legacy rules, migrated to `.opencode/instructions/`)
- Subdirectories like `.opencode/agent/governance/` (use flat structure)

### Agent Discovery

Agents are automatically discovered from:
1. `.opencode/agent/*.md` (flat structure, primary location)
2. OpenCode CLI resolves agent names directly (e.g., `context-steward` → `.opencode/agent/context-steward.md`)

### Creating New Agents

When creating new agents:
1. Use kebab-case naming (e.g., `new-agent.md`)
2. Place directly in `.opencode/agent/` (NOT in subdirectories)
3. Copy template from `.opencode/templates/agents/agent-template.md`
4. Update `.opencode/agent/README.md` to include new agent
5. Update root `AGENTS.md` with agent documentation
6. Add to appropriate logical category in this document

## Linear Integration (Mandatory)

### Before Starting Work

1. **Verify Linear Issue Exists**
   - All significant work (>30 min) must have a Linear issue
   - If no issue exists, create one before proceeding
   - Use branch name from Linear for all git operations

2. **Check Issue Context**
   - Read issue description for requirements
   - Check related issues and parent epics
   - Note acceptance criteria

### During Work

1. **Reference Linear Issue**
   - Include issue ID in all commits: `feat(scope): description [ABC-123]`
   - Link PRs to Linear issues
   - Post progress updates as comments (for long tasks)

### After Completing Work

1. **Update Linear Issue**
   - Change status (In Progress → In Review → Done)
   - Add completion summary as comment
   - Link any created PRs or documentation

## Git Commit Standards

### Commit Format

```
type(scope): description [LINEAR-ID]

- Detail 1
- Detail 2

Refs: LINEAR-ID
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks

### Scope
- Use feature/component name
- Keep consistent with Linear issue scope

## Documentation Standards

### What Goes Where

| Content | Location |
|---------|----------|
| Architecture specs | Mintlify `docs/architecture/` |
| API documentation | Mintlify `docs/api-reference/` |
| Feature specs | Mintlify `docs/features/` |
| User guides | Mintlify `docs/guides/` |
| ADRs | `docs/decisions/` (repo) + Mintlify |
| Quick notes | Directory `AGENTS.md` files |
| Task context | Linear issue description/comments |

### Documentation Triggers

- New feature → Create feature spec in Mintlify
- Architecture change → Create/update ADR
- API change → Update API docs
- Complex decision → Document in Linear issue + ADR

## Audit Trail Requirements

1. **All significant work must be traceable**
   - Linear issue → Git commits → PR → Documentation

2. **Historian agent is called after**:
   - Feature implementation
   - Bug fixes
   - Architecture changes
   - Documentation updates
   - Configuration changes

3. **Skip audit trail only for**:
   - Typo fixes
   - Comment additions
    - Formatting changes

## Agent Scope Enforcement
- linear-coordinator: Linear ops ONLY. RETURN results to orchestrator. No task() delegation.

ALWAYS verify file/dir existence before assumptions—use list(path), glob('**/*'), read(filePath). Examples: Before analysis/delegation, batch list('/Users/eru/Documents/GitHub/project-template/.opencode'), glob('.opencode/**'); read('/Users/eru/Documents/GitHub/project-template/.opencode/project-context.yaml') if assuming missing.

