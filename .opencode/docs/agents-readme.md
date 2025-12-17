# OpenCode Agents

This directory contains all OpenCode agent definitions for the project. Agents are organized by category and can be invoked directly or delegated to by other agents.

## Agent Index

### Governance Agents (4)

Agents responsible for maintaining project organization, history, and system health.

| Agent | Description | Key Tools | Mode |
|-------|-------------|-----------|------|
| [context-steward](context-steward.md) | Path validation, prevent fragmentation | read, list, glob, task | all |
| [historian](historian.md) | Audit trail, structured git commits | read, write, bash, task, linear_* | all |
| [agent-auditor](agent-auditor.md) | Quarterly agent reviews, system health | read, glob, grep, task | all |
| [meta-improvement-analyst](meta-improvement-analyst.md) | Pattern analysis, improvement proposals | read, grep, glob, task, linear_* | all |

### Planning Agents (3)

Agents responsible for requirements, architecture, and project planning.

| Agent | Description | Key Tools | Mode |
|-------|-------------|-----------|------|
| [product-strategist](product-strategist.md) | Requirements, user stories, business case | read, write, task, linear_* | all |
| [strategic-architect](strategic-architect.md) | System architecture, ADRs, technical decisions | read, write, task, linear_* | all |
| [linear-coordinator](linear-coordinator.md) | Linear ticket management, sprint planning | read, write, task, linear_* | all |

### Implementation Agents (3)

Agents responsible for code implementation and deployment.

| Agent | Description | Key Tools | Mode |
|-------|-------------|-----------|------|
| [implementation-specialist](implementation-specialist.md) | Production code implementation | read, write, edit, bash, task, linear_* | all |
| [quick-fixer](quick-fixer.md) | Hotfixes, urgent bugs | read, edit, bash, task, linear_* | all |
| [devops-specialist](devops-specialist.md) | Infrastructure, CI/CD | read, write, edit, bash, task | all |

### Quality Agents (3)

Agents responsible for code quality, testing, and documentation.

| Agent | Description | Key Tools | Mode |
|-------|-------------|-----------|------|
| [code-reviewer](code-reviewer.md) | Technical reviews, security audits | read, grep, glob, task, linear_* | all |
| [test-engineer](test-engineer.md) | Test suite creation, coverage | read, write, edit, bash, task, linear_* | all |
| [documentation-master](documentation-master.md) | API docs, user guides | read, write, task | all |

### Specialized Agents (8)

Agents with specialized expertise for specific domains.

| Agent | Description | Key Tools | Mode |
|-------|-------------|-----------|------|
| [rag-architect](rag-architect.md) | RAG systems, embeddings | read, write, task, linear_* | all |
| [ml-engineer](ml-engineer.md) | ML models, training pipelines | read, write, bash, task, linear_* | all |
| [ai-engineer-agentic](ai-engineer-agentic.md) | DSPy, multi-agent systems | read, write, bash, task, linear_* | all |
| [web-design-guru](web-design-guru.md) | UI/UX, accessibility | read, write, edit, task | all |
| [project-guru](project-guru.md) | Codebase explanations (READ-ONLY) | read, grep, glob | all |
| [brd-creator](brd-creator.md) | Official BRDs, executive summaries | read, write, bash, task | all |
| [agent-engineer](agent-engineer.md) | OpenCode agent maintenance | read, write, edit, task | all |
| [conversation-auditor](conversation-auditor.md) | Conversation compliance (USER-ONLY) | read, grep | **subagent** |

## Agent Relationship Diagram

```
                    ┌─────────────────┐
                    │   Orchestrator  │
                    │ (Phase 4)       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   Planning    │   │Implementation │   │   Quality     │
├───────────────┤   ├───────────────┤   ├───────────────┤
│ • Product     │──▶│ • Impl Spec   │──▶│ • Reviewer    │
│   Strategist  │   │ • Quick Fixer │   │ • Test Eng    │
│ • Architect   │   │ • DevOps      │   │ • Doc Master  │
│ • Linear Coord│   │               │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────┴───────┐
                    │  Governance   │
                    ├───────────────┤
                    │ • Context     │
                    │   Steward     │
                    │ • Historian   │
                    │ • Agent       │
                    │   Auditor     │
                    └───────────────┘

Specialized agents (RAG, ML, AI, Web, etc.) are called by 
Planning/Implementation as needed.
```

## Standard Workflows

### Feature Development

```
product-strategist → strategic-architect → linear-coordinator
                                                    ↓
                              implementation-specialist
                                                    ↓
                                    code-reviewer → test-engineer
                                                    ↓
                                          documentation-master
                                                    ↓
                                               historian
```

### Bug Fix

```
quick-fixer → historian
```

### AI Feature

```
strategic-architect → rag-architect / ml-engineer
                                ↓
                    ai-engineer-agentic
                                ↓
                    implementation-specialist
```

### System Audit

```
agent-auditor → meta-improvement-analyst → agent-engineer
```

## Mode Types

- **`mode: all`** - Agent can be invoked directly OR delegated to by other agents
- **`mode: subagent`** - Agent can ONLY be invoked manually, NOT delegated to

## Linear Integration

Most agents integrate with Linear for issue tracking:

- **Read**: `linear_get_issue`, `linear_list_issues`
- **Write**: `linear_create_issue`, `linear_update_issue`
- **Comments**: `linear_create_comment`, `linear_list_comments`
- **Labels**: `linear_list_issue_labels`
- **Projects**: `linear_list_projects`
- **Cycles**: `linear_list_cycles`

## Mintlify Integration

Documentation agents output to `docs/` for Mintlify sync:

- `docs/requirements/` - PRDs, user stories
- `docs/architecture/` - System designs
- `docs/decisions/` - ADRs
- `docs/official/` - BRDs

## Adding New Agents

1. Create agent file in appropriate category directory
2. Use template from `templates/agent-template.md`
3. Configure YAML frontmatter with:
   - `name`: kebab-case identifier
   - `description`: Brief purpose
   - `mode`: `all` or `subagent`
   - `model`: `opencode/gemini-3-flash`
   - `tools`: Required tools list
4. Define role, capabilities, instructions, guardrails, delegation
5. Update this README with new agent
6. Run agent-auditor for validation



