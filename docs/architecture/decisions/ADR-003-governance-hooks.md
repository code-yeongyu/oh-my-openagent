---
title: "ADR-003: Governance Hooks"
description: "Architecture decision record for the governance system using lifecycle hooks"
status: "accepted"
date: "2025-12-17"
---

# ADR-003: Governance Hooks

## Status

**Accepted**

## Context

As AI agents become more autonomous, there's a need for guardrails that:

1. **Enforce Standards**: Ensure agents follow project conventions
2. **Maintain Audit Trail**: Track what agents do for accountability
3. **Integrate External Systems**: Connect agent work to project management tools
4. **Prevent Mistakes**: Block operations that violate project structure

### Options Considered

1. **Agent Instructions Only**: Rely on system prompts to guide behavior
2. **Post-Hoc Validation**: Review agent outputs after completion
3. **Middleware/Hooks**: Intercept operations in real-time
4. **Separate Governance Service**: External service that validates actions

## Decision

We chose **Lifecycle Hooks** integrated into the plugin's tool execution pipeline.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tool Execution                        │
│                                                          │
│  User/Agent Request                                      │
│         │                                                │
│         ▼                                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │           tool.execute.before                    │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │ 1. Claude Code Hooks                     │    │    │
│  │  │ 2. Non-Interactive Env                   │    │    │
│  │  │ 3. Comment Checker                       │    │    │
│  │  │ 4. Path Validator (LAST - can block)     │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
│         │                                                │
│         ▼                                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Tool Execution                      │    │
│  │         (write, edit, bash, etc.)               │    │
│  └─────────────────────────────────────────────────┘    │
│         │                                                │
│         ▼                                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │           tool.execute.after                     │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │ 1. Output Truncators                     │    │    │
│  │  │ 2. Context Injectors (Rules, README)     │    │    │
│  │  │ 3. Historian (LAST - records changes)    │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Three Governance Hooks

#### 1. Path Validator (`governance-path-validator`)

**Purpose**: Prevent agents from creating files in unauthorized locations

**Mechanism**:
- Intercepts `write` and `edit` tool calls
- Validates path against `allowed_paths` whitelist
- Modes: `warn` (log only), `block` (throw error), `disabled`

**Default Allowed Paths**:
```
src/, docs/, tests/, lib/, packages/
context/specs/, context/memory/
.cursor/specs/, .cursor/memory/
.opencode/
```

#### 2. Historian (`governance-historian`)

**Purpose**: Maintain automated audit trail of agent work

**Mechanism**:
- Tracks files created/modified during session
- On session end, generates changelog entry
- Infers scope from file paths (e.g., `src/auth/` → scope: `auth`)

**Output Format**:
```markdown
# Changelog: 2025-12-17

**Agent**: OmO
**Scope**: auth-system
**Session**: sess_abc123

## Files Changed
- `+` src/auth/login.ts (created)
- `~` src/auth/types.ts (modified)
```

#### 3. Linear Injector (`governance-linear-injector`)

**Purpose**: Automatically inject Linear issue context into agent prompts

**Mechanism**:
- Scans chat messages for `{TEAM_PREFIX}-\d+` patterns
- Fetches issue details via Linear API
- Injects `<linear_context>` block into prompt
- Caches issues per session to avoid redundant API calls

### Configuration

```typescript
governance: {
  path_validation: {
    enabled: true,
    mode: "warn" | "block" | "disabled",
    allowed_paths: string[]
  },
  historian: {
    enabled: true,
    auto_create: true,
    changelog_path: "changelog/",
    min_changes: 1
  },
  linear: {
    enabled: true,
    team_prefix: "LIF",
    cache_issues: true
  }
}
```

## Consequences

### Positive

- **Real-Time Enforcement**: Issues caught before they happen
- **Automatic Documentation**: Changelog generated without manual effort
- **Seamless Integration**: Linear context injected transparently
- **Configurable**: Each hook can be enabled/disabled/tuned
- **Non-Invasive**: Hooks don't modify agent code

### Negative

- **Performance Overhead**: Each tool call passes through hook chain
- **Complexity**: More code paths to debug
- **False Positives**: Path validator may block legitimate operations
- **External Dependency**: Linear injector requires MCP configuration

### Mitigations

- **Hook Ordering**: Critical hooks run last (Path Validator before, Historian after)
- **Warn Mode**: Default to warnings, not blocks
- **Configurable Paths**: Users can customize allowed paths
- **Graceful Degradation**: Hooks fail silently if dependencies unavailable

## Alternatives Rejected

### Agent Instructions Only
- **Rejected because**: Agents can ignore instructions; no enforcement mechanism

### Post-Hoc Validation
- **Rejected because**: Damage already done; harder to remediate

### Separate Governance Service
- **Rejected because**: Adds latency and external dependency; hooks are simpler

## Future Considerations

1. **More Governance Hooks**: Security scanning, dependency validation
2. **Hook Composition**: Allow hooks to communicate/coordinate
3. **Audit Dashboard**: Visualize changelog history
4. **Policy Language**: DSL for defining governance rules

## References

- [Governance System Documentation](/architecture/07-governance-system)
- [Hook System Documentation](/architecture/04-hook-system)
- Source: `src/hooks/governance-path-validator/`
- Source: `src/hooks/governance-historian/`
- Source: `src/hooks/governance-linear-injector/`
