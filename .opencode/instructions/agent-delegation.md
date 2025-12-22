# Agent Delegation Guide

> How to delegate work to specialized agents in oh-my-opencode.

## Overview

OhMyOpenCode uses TypeScript agents in the plugin for structured delegation. Instead of reading markdown agent files, use `call_omo_agent()` to delegate work.

## Delegation Pattern

### Basic Syntax

```
call_omo_agent(
  subagent_type="agent-name",
  run_in_background=false,
  prompt="TASK: What to do..."
)
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `subagent_type` | Yes | Agent name (e.g., `product-strategist`) |
| `run_in_background` | Yes | `false` for sync, `true` for async |
| `prompt` | Yes | Detailed task instructions |
| `description` | No | Short description for tracking |

## Available Agents

### Workflow Specialists

| Agent | Purpose | Model |
|-------|---------|-------|
| `product-strategist` | Create specs from requirements | Claude Sonnet 4.5 |
| `strategic-planner` | Create implementation plans | Claude Sonnet 4.5 |
| `task-planner` | Create task breakdowns | Claude Sonnet 4.5 |

### Implementation Specialists

| Agent | Purpose | Model |
|-------|---------|-------|
| `implementation-specialist` | Coordinate implementation | Claude Sonnet 4.5 |
| `backend-typescript` | TypeScript backend code | Claude Sonnet 4.5 |
| `frontend-react` | React/Next.js frontend | Gemini Pro |
| `frontend-ui-ux-engineer` | UI/UX design | Gemini Pro |

### Quality Specialists

| Agent | Purpose | Model |
|-------|---------|-------|
| `oracle` | Code review, architecture | GPT-5.2 |
| `test-specialist` | Testing | Claude Sonnet 4.5 |

### Research Agents

| Agent | Purpose | Model |
|-------|---------|-------|
| `explore` | Codebase search | Grok |
| `librarian` | External docs research | Claude Sonnet 4.5 |

### Utility Agents

| Agent | Purpose | Model |
|-------|---------|-------|
| `document-writer` | Documentation | Gemini Pro |
| `multimodal-looker` | Image/PDF analysis | Gemini Flash |

## Command → Agent Mapping

| Command | Delegates To |
|---------|--------------|
| `/specify` | `product-strategist` |
| `/plan` | `strategic-planner` |
| `/tasks` | `task-planner` |
| `/implement` | `implementation-specialist` |
| `/review` | `oracle` |
| `/test` | `test-specialist` |

## Examples

### Synchronous Delegation

```
call_omo_agent(
  subagent_type="product-strategist",
  run_in_background=false,
  prompt="""
  TASK: Create feature specification
  
  FEATURE: User authentication with OAuth
  SPEC_DIR: .cursor/specs/LIF-123-feat-auth/
  
  REQUIREMENTS:
  - OAuth 2.0 with Google and GitHub
  - JWT token management
  - Session persistence
  
  DELIVERABLES:
  - spec.md with user stories
  - Acceptance criteria
  - Success metrics
  """
)
```

### Background Research

```
background_task(
  agent="explore",
  prompt="Find all authentication implementations in src/"
)

background_task(
  agent="librarian", 
  prompt="Look up NextAuth.js official documentation for OAuth setup"
)
```

### Implementation Delegation

```
call_omo_agent(
  subagent_type="implementation-specialist",
  run_in_background=false,
  prompt="""
  TASK: Implement OAuth authentication
  
  SPEC_DIR: .cursor/specs/LIF-123-feat-auth/
  
  CONTEXT:
  - Read spec.md for requirements
  - Read plan.md for architecture
  - Read tasks.md for task breakdown
  
  DELEGATION:
  - Use backend-typescript for API routes
  - Use frontend-react for login components
  """
)
```

## Governance Integration

Governance is automatic via hooks—no explicit calls needed:

- **Path Validation**: `governance-path-validator` hook
- **Audit Trail**: `governance-historian` hook  
- **Linear Context**: `governance-linear-injector` hook

Agents don't need to call governance agents. Just focus on the task.

## Migration from Markdown Agents

### Old Pattern (Deprecated)

```markdown
5. **Engage Product Strategist Agent**:
   - Read `.opencode/agent/product-strategist.md`
   - Adopt Product Strategist persona
```

### New Pattern

```markdown
4. **Delegate to Product Strategist Agent**:
   call_omo_agent(
     subagent_type="product-strategist",
     run_in_background=false,
     prompt="..."
   )
```

## Best Practices

1. **Use sync for critical paths**: `run_in_background=false` for workflow steps
2. **Use async for research**: `background_task` for explore/librarian
3. **Include full context**: Pass spec paths, Linear IDs, constraints
4. **Let governance happen**: Don't call context-steward/historian—hooks handle it
5. **Persist state**: Call `update_workflow_state` after workflow steps
