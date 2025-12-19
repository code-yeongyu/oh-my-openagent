# LIF-57: Comprehensive Architecture Analysis

**Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
**Created**: 2025-12-17
**Revised**: 2025-12-17 (Critical Finding: OpenCode Native Agent Loading)
**Author**: Strategic Architect
**Status**: Analysis Complete - REVISED

---

> **CRITICAL REVISION (2025-12-17)**
> 
> **New Finding**: OpenCode NATIVELY supports `.opencode/agent/` agents.
> 
> The original analysis incorrectly stated that OmO's Claude agent loader needed extension.
> This is WRONG. OpenCode has its own native agent loading from `.opencode/agent/`.
> OmO's `.claude/agents/` loader is SUPPLEMENTARY for Claude Code compatibility only.
> 
> **Corrected Findings**:
> - ~~Agent loader extension needed~~ → **NOT NEEDED** (OpenCode native)
> - ~~Agent format conversion needed~~ → **NOT NEEDED** (YAML object format works)
> - Our agents in `.opencode/agent/` already work natively with OpenCode

---

## Executive Summary

This document provides a **comprehensive strategic architecture review** of integrating governance patterns from our `.opencode/` orchestration system into oh-my-opencode (OmO). After deep analysis of OmO's plugin architecture, hook system, agent loader, and tool patterns, I've identified **critical integration gaps**, **architectural conflicts**, and **specific recommendations** for successful enhancement.

### Key Findings (REVISED)

1. **OmO's plugin architecture is well-designed for extension** - The hook system, tool registration, and agent loading all support our governance additions
2. **OpenCode NATIVELY loads agents from `.opencode/agent/`** - No loader extension needed
3. **Our agent format is CORRECT** - YAML object format for tools (`tools: { read: true }`) is the OpenCode native format
4. **Hook execution order matters** - Our governance hooks must be positioned correctly in the lifecycle
5. **Linear MCP is already configured** - In `opencode.json`, not OmO's MCP config

---

## 1. System Integration Analysis

### 1.1 Component Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OmO Plugin Architecture                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │  Plugin Entry   │    │   Config Layer  │    │   MCP Layer     │          │
│  │  (index.ts)     │───▶│  (schema.ts)    │───▶│  (mcp/index.ts) │          │
│  └────────┬────────┘    └─────────────────┘    └─────────────────┘          │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                        Hook System                               │        │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │        │
│  │  │tool.execute  │ │tool.execute  │ │    event     │             │        │
│  │  │   .before    │ │   .after     │ │   handler    │             │        │
│  │  └──────────────┘ └──────────────┘ └──────────────┘             │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                        Tool Registry                             │        │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │        │
│  │  │ builtins │ │background│ │call_omo  │ │ look_at  │            │        │
│  │  │  (LSP,   │ │  tools   │ │  agent   │ │          │            │        │
│  │  │ AST,etc) │ │          │ │          │ │          │            │        │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                       Agent Registry                             │        │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │        │
│  │  │ Builtin  │ │  User    │ │ Project  │ │  Config  │            │        │
│  │  │ Agents   │ │ Agents   │ │ Agents   │ │ Overrides│            │        │
│  │  │ (omo.ts) │ │(~/.claude)│ │(.claude/)│ │          │            │        │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Analysis

**Request Flow (User → Agent → Tool)**:
```
User Message
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. chat.message hook                                                     │
│    - claudeCodeHooks["chat.message"]                                     │
│    - keywordDetector?.["chat.message"]                                   │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. event hook (session.created, session.updated)                        │
│    - All hooks receive event                                             │
│    - Session state tracking                                              │
│    - Terminal title updates                                              │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. tool.execute.before hook                                             │
│    - claudeCodeHooks["tool.execute.before"]                             │
│    - nonInteractiveEnv?.["tool.execute.before"]                         │
│    - commentChecker?.["tool.execute.before"]                            │
│    - Task tool arg modification (disables background_task, etc.)        │
│    ┌───────────────────────────────────────────────────────────────┐    │
│    │ *** OUR HOOK INSERTION POINT: governance-path-validator ***   │    │
│    │     Must validate path BEFORE write/edit executes             │    │
│    └───────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. TOOL EXECUTION                                                        │
│    - write, edit, bash, read, grep, glob, LSP tools, etc.               │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. tool.execute.after hook                                              │
│    - claudeCodeHooks["tool.execute.after"]                              │
│    - toolOutputTruncator?.["tool.execute.after"]                        │
│    - contextWindowMonitor?.["tool.execute.after"]                       │
│    - commentChecker?.["tool.execute.after"]                             │
│    - directoryAgentsInjector?.["tool.execute.after"]                    │
│    - directoryReadmeInjector?.["tool.execute.after"]                    │
│    - rulesInjector?.["tool.execute.after"]                              │
│    - emptyTaskResponseDetector?.["tool.execute.after"]                  │
│    - agentUsageReminder?.["tool.execute.after"]                         │
│    - interactiveBashSession?.["tool.execute.after"]                     │
│    ┌───────────────────────────────────────────────────────────────┐    │
│    │ *** OUR HOOK INSERTION POINT: governance-historian ***        │    │
│    │     Must track file modifications for changelog               │    │
│    └───────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. session.idle event                                                    │
│    - todoContinuationEnforcer checks for incomplete todos               │
│    - Terminal title updates                                              │
│    ┌───────────────────────────────────────────────────────────────┐    │
│    │ *** OUR HOOK INSERTION POINT: governance-linear-injector ***  │    │
│    │     Inject Linear context on session events                   │    │
│    └───────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Circular Dependencies Analysis

**No circular dependencies detected** in the proposed integration. However, there are **execution order dependencies**:

| Component | Depends On | Reason |
|-----------|------------|--------|
| governance-historian | governance-path-validator | Must only log valid file writes |
| Agent markdown files | Agent loader extension | Loader must support `.opencode/agent/` |
| OmO prompt awareness | Tools exist | Can't reference tools that don't exist |
| Linear tools | Linear MCP or SDK | Need API access |

### 1.4 Potential Conflicts Identified

| Conflict | Severity | Description | Resolution |
|----------|----------|-------------|------------|
| **Path validation vs user intent** | Medium | May block legitimate files outside `context/` | Configurable allowed paths |
| **Changelog verbosity** | Low | May create too many changelog entries | Threshold for "significant" changes |
| **Agent name collisions** | Medium | Our agents may conflict with user's | Prefix with `gov-` or use namespace |
| **Hook execution order** | High | Our hooks may interfere with existing | Careful positioning in lifecycle |
| **Linear MCP absence** | High | OmO doesn't include Linear MCP | Add to MCP config or use native tools |

---

## 2. OmO Plugin Architecture Deep Dive

### 2.1 Plugin Entry Point (`src/index.ts`)

The OmO plugin follows a clear pattern:

```typescript
const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  // 1. Load config
  const pluginConfig = loadPluginConfig(ctx.directory);
  
  // 2. Check which hooks are enabled
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);
  
  // 3. Instantiate hooks conditionally
  const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null;
  
  // 4. Return plugin object with lifecycle hooks
  return {
    tool: { /* tools */ },
    "chat.message": async (input, output) => { /* ... */ },
    config: async (config) => { /* modify config */ },
    event: async (input) => { /* handle events */ },
    "tool.execute.before": async (input, output) => { /* ... */ },
    "tool.execute.after": async (input, output) => { /* ... */ },
  };
};
```

**Key Insight**: Hooks are instantiated once at plugin load, then called on every relevant event. This means:
- State can be maintained across calls (e.g., `sessionCaches` in rules-injector)
- Hooks must be defensive about null checks
- Order of hook calls in lifecycle methods matters

### 2.2 OmO Agent Definition (`src/agents/omo.ts`)

The OmO agent is 778 lines of carefully crafted system prompt with these key sections:

| Section | Lines | Purpose |
|---------|-------|---------|
| `<Role>` | 3-8 | Identity and mission |
| `<Intent_Gate>` | 10-55 | Intent classification on EVERY message |
| `<Todo_Management>` | 57-92 | Obsessive todo tracking |
| `<Blocking_Gates>` | 94-127 | Mandatory pre-conditions |
| `<Search_Strategy>` | 129-213 | When to use explore vs librarian |
| `<Oracle>` | 215-279 | When to consult Oracle |
| `<Delegation_Rules>` | 281-360 | 7-section prompt structure |
| `<Implementation_Flow>` | 362-412 | Implementation workflow |
| `<Exploration_Flow>` | 414-436 | Exploration workflow |
| `<Playbooks>` | 438-486 | Bugfix, refactor, debug, migration flows |
| `<Tools>` | 488-514 | Tool selection matrix |
| `<Parallel_Execution>` | 516-555 | When to parallelize |
| `<Verification_Protocol>` | 557-580 | Mandatory verification |
| `<Failure_Handling>` | 582-635 | Error handling patterns |
| `<Agency>` | 637-649 | Behavior guidelines |
| `<Conventions>` | 651-666 | Code conventions |
| `<Anti_Patterns>` | 668-727 | What NOT to do |
| `<Decision_Matrix>` | 729-747 | Quick decision lookup |
| `<Final_Reminders>` | 749-762 | Key reminders |

**Critical Finding**: OmO's prompt is HIGHLY structured. Adding a `<Governance>` section must follow the same pattern and integrate with existing sections (especially `<Tools>`, `<Decision_Matrix>`, `<Blocking_Gates>`).

### 2.3 Agent Loader (`src/features/claude-code-agent-loader/loader.ts`)

**Current Behavior**:
```typescript
// Line 81-82: ONLY loads from .claude/agents
export function loadProjectAgents(): Record<string, AgentConfig> {
  const projectAgentsDir = join(process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")
  // ...
}
```

**Agent Frontmatter Format**:
```typescript
// Line 9-20: Tools are comma-separated string, NOT YAML object
function parseToolsConfig(toolsStr?: string): Record<string, boolean> | undefined {
  if (!toolsStr) return undefined
  const tools = toolsStr.split(",").map((t) => t.trim()).filter(Boolean)
  // ...
}
```

**Critical Finding**: Our agent markdown files MUST use:
```yaml
---
name: context-steward
description: Enforce path discipline
tools: read,list,glob,grep
---
```

NOT:
```yaml
---
tools:
  read: true
  list: true
---
```

### 2.4 Hook Patterns

Analyzing existing hooks reveals consistent patterns:

**Pattern 1: Tool-based hooks** (rules-injector, comment-checker):
```typescript
export function createMyHook(ctx: PluginInput) {
  // State maintained across calls
  const sessionCaches = new Map<string, SomeState>();
  
  return {
    "tool.execute.after": async (input, output) => {
      // Check tool type
      if (!TRACKED_TOOLS.includes(input.tool.toLowerCase())) return;
      // Modify output or track state
      output.output += "\n[Additional context]";
    },
    event: async ({ event }) => {
      // Handle session lifecycle
      if (event.type === "session.deleted") {
        // Cleanup state
      }
    },
  };
}
```

**Pattern 2: Session-based hooks** (todo-continuation-enforcer, session-recovery):
```typescript
export function createMyHook(ctx: PluginInput) {
  const sessionState = new Set<string>();
  
  return {
    handler: async ({ event }) => {
      if (event.type === "session.idle") {
        // Check state and potentially inject prompt
        await ctx.client.session.prompt({ /* ... */ });
      }
    },
  };
}
```

---

## 3. Gap Analysis

### 3.1 Current Plan Gaps

| Gap | Current Plan | Issue | Recommendation |
|-----|--------------|-------|----------------|
| **Agent Loader Path** | Create agents in `.opencode/agent/` | Loader only checks `.claude/agents/` | Extend loader OR use `.claude/agents/` |
| **Linear MCP** | Assume Linear MCP exists | OmO doesn't include Linear MCP | Add to MCP config or use native tools |
| **OmO Prompt Awareness** | Add `<Governance>` section | Not integrated with `<Tools>`, `<Decision_Matrix>` | Update ALL relevant sections |
| **Hook Registration** | Add to `HookNameSchema` | Schema is in `src/config/schema.ts` | Also update `HookName` type |
| **Tool Availability** | Create tools | OmO must KNOW about tools | Update OmO prompt with tool docs |
| **Config Schema** | Create governance config | No schema for governance options | Add to `OhMyOpenCodeConfigSchema` |

### 3.2 Missing Integration Points

**1. Linear Integration Options**:

OmO's MCPs are defined in `src/mcp/`:
```typescript
// Current MCPs: websearch_exa, context7, grep_app
// Linear is NOT included
```

**Options**:
- **Option A**: Add Linear MCP to OmO's MCP config
- **Option B**: Use OpenCode's built-in Linear tools (if available)
- **Option C**: Create custom Linear tools using Linear SDK directly

**Recommendation**: Option C - Create custom tools. This gives us full control and doesn't depend on external MCP availability.

**2. Configuration Schema Extension**:

Current schema in `src/config/schema.ts` doesn't have governance options:
```typescript
export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  disabled_mcps: z.array(McpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  google_auth: z.boolean().optional(),
  omo_agent: OmoAgentConfigSchema.optional(),
  // MISSING: governance config
})
```

**Need to add**:
```typescript
governance: z.object({
  path_validation: z.object({
    enabled: z.boolean().default(true),
    allowed_paths: z.array(z.string()).optional(),
  }).optional(),
  historian: z.object({
    enabled: z.boolean().default(true),
    changelog_format: z.enum(["markdown", "json"]).default("markdown"),
  }).optional(),
  linear_injection: z.object({
    enabled: z.boolean().default(true),
    team_prefix: z.string().default("LIF"),
  }).optional(),
}).optional(),
```

### 3.3 Architectural Conflicts

**Conflict 1: Path Validation vs Flexibility**

OmO is designed to be flexible. Adding path validation may conflict with:
- Users who don't use `context/specs/` structure
- Projects with different conventions
- Quick fixes that legitimately write to unusual paths

**Resolution**: Make path validation configurable with sensible defaults:
```typescript
// Default: warn but allow
// Strict mode: block invalid paths
// Disabled: no validation
```

**Conflict 2: Changelog Overhead**

Creating changelog entries after every file write may:
- Slow down rapid iteration
- Create too many small entries
- Conflict with user's manual changelog management

**Resolution**: Implement "significant change" detection:
- Track files modified in session
- Create ONE changelog entry per session/task
- Configurable threshold (e.g., only for 3+ files or specific paths)

**Conflict 3: Agent Naming**

Our agents (context-steward, historian, linear-coordinator) may conflict with:
- User's custom agents with same names
- Future OmO built-in agents

**Resolution**: Use a namespace prefix:
- `gov-context-steward` or `governance-context-steward`
- Document naming convention
- Allow override in config

---

## 4. Agent Prompt Engineering

### 4.1 OmO Prompt Updates

The OmO prompt needs updates in **multiple sections**, not just adding a new `<Governance>` section:

**Section 1: `<Tools>` (Lines 488-514)**

Add governance tools to the tool selection matrix:
```markdown
### Governance Tools (NEW)
| Need | Tool |
|------|------|
| Get Linear branch name | linear_branch |
| Update Linear issue status | linear_update_status |
| Create Linear issue | linear_create_issue |
| Read project context | read_context |
| Create spec folder | create_spec_folder |
| Validate path | (automatic via hook) |
| Create changelog | (automatic via hook) |
```

**Section 2: `<Decision_Matrix>` (Lines 729-747)**

Add governance decisions:
```markdown
| Situation | Action |
|-----------|--------|
| "Start work on Linear issue" | linear_branch → get branch name |
| "Complete a task" | linear_update_status → mark done |
| "New feature request" | linear_create_issue → create ticket |
| "Understand project setup" | read_context → get config |
| "Start new feature" | create_spec_folder → setup spec dir |
| "Create spec folder" | create_spec_folder → auto-creates structure |
```

**Section 3: `<Blocking_Gates>` (Lines 94-127)**

Add governance gates:
```markdown
### GATE 5: Pre-Spec (NEW)
- [BLOCKING] For features >30 min, MUST have spec folder
- [BLOCKING] MUST use Linear issue ID in folder name if available
- [BLOCKING] MUST NOT create random folders in context/

### GATE 6: Post-Completion (NEW)
- [BLOCKING] MUST update Linear issue status
- [BLOCKING] Changelog entry created (automatic)
```

**Section 4: New `<Governance>` Section**

```markdown
<Governance>
## Governance Integration

### Path Discipline
- All spec work goes to `context/specs/{ISSUE-ID}-{type}-{name}/`
- Memory files go to `context/memory/`
- Code goes to `src/`, `tests/`, `docs/`
- Path validation hook will WARN on invalid paths

### Linear Workflow
When starting work on a Linear issue:
1. Call `linear_branch` to get the correct branch name
2. Create/checkout the branch
3. Call `create_spec_folder` for new features
4. Work on the feature
5. Call `linear_update_status` when done

### Changelog Discipline
- Historian hook automatically tracks file modifications
- Changelog entry created on session end or explicit trigger
- Format: `changelog/YYYY-MM-DD__{agent}__{scope}.md`

### Governance Agents (Delegate When Needed)
- `context-steward` - Path validation, structure enforcement
- `historian` - Manual changelog creation
- `linear-coordinator` - Complex Linear operations

### When to Use Governance Tools
| Trigger | Tool/Action |
|---------|-------------|
| User mentions "LIF-XXX" | linear_branch → get branch |
| Starting new feature | create_spec_folder |
| Completing task | linear_update_status |
| Need project config | read_context |
</Governance>
```

### 4.2 Other OmO Agents

**Should Oracle, Explore, Librarian be governance-aware?**

| Agent | Governance Awareness | Reason |
|-------|---------------------|--------|
| **Oracle** | Minimal | Architecture advice, not file operations |
| **Explore** | No | Read-only codebase exploration |
| **Librarian** | No | External documentation only |
| **Frontend-UI-UX-Engineer** | Yes | Creates files, should follow path discipline |
| **Document-Writer** | Yes | Creates docs, should follow conventions |

**Recommendation**: Only OmO and file-creating agents need governance awareness. Add a brief note to frontend-ui-ux-engineer and document-writer prompts:

```markdown
## Path Discipline
When creating files:
- Follow project path conventions
- Use context/specs/ for spec-related files
- Use docs/ for documentation
```

### 4.3 Ensuring Agents USE Governance Tools

The key challenge is making OmO **actually use** the governance tools. Strategies:

**1. Trigger Words in Prompt**:
```markdown
When user mentions these, AUTOMATICALLY use governance tools:
- "LIF-XXX" → linear_branch
- "new feature" → create_spec_folder
- "done", "complete", "finished" → linear_update_status
```

**2. Decision Matrix Integration**:
Add governance decisions to the existing decision matrix so OmO's trained pattern-matching kicks in.

**3. Blocking Gates**:
Make governance a BLOCKING gate so OmO can't skip it:
```markdown
### GATE 5: Pre-Feature (NEW)
- [BLOCKING] For features >30 min, MUST call create_spec_folder
- [BLOCKING] If Linear issue mentioned, MUST call linear_branch
```

**4. Final Reminders**:
```markdown
## Remember
- **Governance tools are available** - use linear_branch, linear_update_status, create_spec_folder
- **Path discipline** - context/specs/ for specs, src/ for code
- **Linear integration** - always get branch name, update status
```

---

## 5. Configuration Architecture

### 5.1 Configuration Schema

**File**: `src/config/schema.ts`

Add governance configuration:

```typescript
export const GovernancePathValidationSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["warn", "block", "disabled"]).default("warn"),
  allowed_paths: z.array(z.string()).default([
    "context/specs/",
    "context/memory/",
    "src/",
    "tests/",
    "docs/",
    ".opencode/",
    ".claude/",
  ]),
  blocked_patterns: z.array(z.string()).default([
    "context/*",  // Block direct context/ writes
  ]),
});

export const GovernanceHistorianSchema = z.object({
  enabled: z.boolean().default(true),
  changelog_format: z.enum(["markdown", "json"]).default("markdown"),
  changelog_path: z.string().default("changelog/"),
  min_files_for_entry: z.number().default(1),
  auto_create: z.boolean().default(true),
});

export const GovernanceLinearSchema = z.object({
  enabled: z.boolean().default(true),
  team_prefix: z.string().default("LIF"),
  auto_inject_context: z.boolean().default(true),
  auto_update_status: z.boolean().default(false),
});

export const GovernanceConfigSchema = z.object({
  path_validation: GovernancePathValidationSchema.optional(),
  historian: GovernanceHistorianSchema.optional(),
  linear: GovernanceLinearSchema.optional(),
});

// Update main schema
export const OhMyOpenCodeConfigSchema = z.object({
  // ... existing fields
  governance: GovernanceConfigSchema.optional(),
});
```

### 5.2 Default Configuration

**File**: `.opencode/oh-my-opencode.json`

```json
{
  "$schema": "https://oh-my-opencode.dev/schema.json",
  "disabled_hooks": [],
  "governance": {
    "path_validation": {
      "enabled": true,
      "mode": "warn",
      "allowed_paths": [
        "context/specs/",
        "context/memory/",
        "src/",
        "tests/",
        "docs/",
        ".opencode/",
        ".claude/"
      ]
    },
    "historian": {
      "enabled": true,
      "changelog_format": "markdown",
      "auto_create": true
    },
    "linear": {
      "enabled": true,
      "team_prefix": "LIF",
      "auto_inject_context": true
    }
  }
}
```

### 5.3 Opt-Out Mechanisms

Users can opt out at multiple levels:

**1. Disable entire governance**:
```json
{
  "disabled_hooks": [
    "governance-path-validator",
    "governance-historian",
    "governance-linear-injector"
  ]
}
```

**2. Disable specific features**:
```json
{
  "governance": {
    "path_validation": { "enabled": false },
    "historian": { "enabled": false },
    "linear": { "enabled": false }
  }
}
```

**3. Customize behavior**:
```json
{
  "governance": {
    "path_validation": {
      "mode": "disabled",
      "allowed_paths": ["my/custom/path/"]
    }
  }
}
```

---

## 6. Error Handling & Edge Cases

### 6.1 Path Validation Blocks Legitimate File

**Scenario**: User wants to create a file in `/tmp/test.txt` but path validation blocks it.

**Current Plan Issue**: Plan says "block" but doesn't handle edge cases.

**Recommendation**:
1. **Default to "warn" mode** - Log warning but allow operation
2. **Provide escape hatch** - `// @governance-ignore` comment or tool flag
3. **Configurable allowed paths** - User can add custom paths

**Implementation**:
```typescript
// In governance-path-validator hook
if (!isValidPath(filePath)) {
  if (config.mode === "block") {
    output.output = `[BLOCKED] Invalid path: ${filePath}. Use context/specs/ for specs.`;
    return { blocked: true };
  } else if (config.mode === "warn") {
    output.output += `\n[WARNING] Path ${filePath} is outside standard locations.`;
  }
}
```

### 6.2 Linear API Unavailable

**Scenario**: Linear API is down or user doesn't have API key.

**Current Plan Issue**: No fallback behavior defined.

**Recommendation**:
1. **Graceful degradation** - Continue without Linear features
2. **Cache issue data** - Use last known state
3. **Clear error messages** - Tell user what's not working

**Implementation**:
```typescript
// In linear tools
try {
  const issue = await linearClient.issue(issueId);
  return { branchName: issue.branchName, ... };
} catch (error) {
  if (error.code === 'ENOTFOUND' || error.code === 'UNAUTHORIZED') {
    return {
      error: true,
      message: `Linear API unavailable: ${error.message}`,
      fallback: `${issueId.toLowerCase()}-feature`,
      suggestion: "Check LINEAR_API_KEY environment variable"
    };
  }
  throw error;
}
```

### 6.3 Changelog Creation Fails

**Scenario**: Disk full, permissions issue, or invalid path.

**Current Plan Issue**: No error handling defined.

**Recommendation**:
1. **Don't block main operation** - Changelog is supplementary
2. **Log error clearly** - User should know changelog wasn't created
3. **Retry mechanism** - Try once more with fallback path

**Implementation**:
```typescript
// In governance-historian hook
try {
  await createChangelogEntry(entry);
} catch (error) {
  console.error(`[governance-historian] Failed to create changelog: ${error.message}`);
  // Try fallback to session log
  try {
    await appendToSessionLog(entry);
  } catch {
    // Log but don't block
    console.error(`[governance-historian] Fallback also failed. Changes not logged.`);
  }
}
```

### 6.4 Agent Loader Fails to Find Agents

**Scenario**: `.opencode/agent/` doesn't exist or agents have invalid frontmatter.

**Current Plan Issue**: Assumes loader extension works perfectly.

**Recommendation**:
1. **Silent fallback** - If `.opencode/agent/` doesn't exist, continue
2. **Log invalid agents** - Don't crash, just skip with warning
3. **Validate frontmatter** - Check required fields before loading

**Implementation**:
```typescript
// In extended loadProjectAgents
function loadAgentsFromDir(dir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(dir)) {
    return []; // Silent fallback
  }
  
  const agents: LoadedAgent[] = [];
  for (const entry of entries) {
    try {
      const { data, body } = parseFrontmatter(content);
      if (!data.description) {
        console.warn(`[agent-loader] Skipping ${entry.name}: missing description`);
        continue;
      }
      // ... rest of loading
    } catch (error) {
      console.warn(`[agent-loader] Failed to load ${entry.name}: ${error.message}`);
      continue;
    }
  }
  return agents;
}
```

### 6.5 Hook Conflicts with Existing Hooks

**Scenario**: Our governance-path-validator conflicts with claude-code-hooks or comment-checker.

**Current Plan Issue**: Hook execution order not specified.

**Recommendation**:
1. **Position governance hooks last** - Let existing hooks run first
2. **Check for conflicts** - If another hook blocked, don't double-block
3. **Document hook order** - Make it clear in code comments

**Implementation**:
```typescript
// In src/index.ts
"tool.execute.before": async (input, output) => {
  // 1. Existing hooks first (may modify args)
  await claudeCodeHooks["tool.execute.before"](input, output);
  await nonInteractiveEnv?.["tool.execute.before"](input, output);
  await commentChecker?.["tool.execute.before"](input, output);
  
  // 2. Task tool modifications
  if (input.tool === "task") { /* ... */ }
  
  // 3. Governance hooks LAST (after all modifications)
  // Check if already blocked by another hook
  if (output.blocked) return;
  await governancePathValidator?.["tool.execute.before"](input, output);
},
```

---

## 7. Testing Strategy

### 7.1 Hook Integration Tests

**Test Suite: governance-path-validator**

```typescript
describe("governance-path-validator", () => {
  it("allows valid context/specs/ paths", async () => {
    const hook = createGovernancePathValidatorHook(mockCtx);
    const output = { title: "context/specs/LIF-57-feat-test/spec.md", output: "" };
    await hook["tool.execute.before"]({ tool: "write" }, output);
    expect(output.blocked).toBeUndefined();
  });

  it("warns on invalid paths in warn mode", async () => {
    const hook = createGovernancePathValidatorHook(mockCtx, { mode: "warn" });
    const output = { title: "random/path/file.txt", output: "" };
    await hook["tool.execute.before"]({ tool: "write" }, output);
    expect(output.output).toContain("[WARNING]");
    expect(output.blocked).toBeUndefined();
  });

  it("blocks invalid paths in block mode", async () => {
    const hook = createGovernancePathValidatorHook(mockCtx, { mode: "block" });
    const output = { title: "random/path/file.txt", output: "" };
    await hook["tool.execute.before"]({ tool: "write" }, output);
    expect(output.blocked).toBe(true);
  });

  it("respects custom allowed paths", async () => {
    const hook = createGovernancePathValidatorHook(mockCtx, { 
      allowed_paths: ["custom/path/"] 
    });
    const output = { title: "custom/path/file.txt", output: "" };
    await hook["tool.execute.before"]({ tool: "write" }, output);
    expect(output.blocked).toBeUndefined();
  });
});
```

**Test Suite: governance-historian**

```typescript
describe("governance-historian", () => {
  it("tracks file modifications", async () => {
    const hook = createGovernanceHistorianHook(mockCtx);
    await hook["tool.execute.after"]({ tool: "write", sessionID: "test" }, { title: "src/file.ts" });
    await hook["tool.execute.after"]({ tool: "edit", sessionID: "test" }, { title: "src/other.ts" });
    // Verify tracking
    const state = hook.getSessionState("test");
    expect(state.modifiedFiles).toHaveLength(2);
  });

  it("creates changelog on session end", async () => {
    const hook = createGovernanceHistorianHook(mockCtx);
    await hook["tool.execute.after"]({ tool: "write", sessionID: "test" }, { title: "src/file.ts" });
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "test" } } } });
    // Verify changelog created
    expect(fs.existsSync("changelog/")).toBe(true);
  });
});
```

### 7.2 Tool Functionality Tests

**Test Suite: linear_branch**

```typescript
describe("linear_branch", () => {
  it("returns branch name for valid issue", async () => {
    mockLinearClient.issue.mockResolvedValue({ branchName: "eru/lif-57-feature" });
    const result = await linear_branch.execute({ issueId: "LIF-57" });
    expect(result.branchName).toBe("eru/lif-57-feature");
  });

  it("handles API errors gracefully", async () => {
    mockLinearClient.issue.mockRejectedValue(new Error("Not found"));
    const result = await linear_branch.execute({ issueId: "LIF-999" });
    expect(result.error).toBe(true);
    expect(result.fallback).toBe("lif-999-feature");
  });
});
```

### 7.3 Agent Behavior Tests

**Test Suite: OmO Governance Behavior**

These are harder to test automatically but can be verified manually:

```markdown
## Manual Test Cases

### Test 1: Linear Branch Trigger
1. Start OmO session
2. Say "I want to work on LIF-57"
3. Verify: OmO calls linear_branch tool
4. Verify: OmO suggests correct branch name

### Test 2: Spec Folder Creation
1. Start OmO session
2. Say "Create a new feature for user authentication"
3. Verify: OmO calls create_spec_folder tool
4. Verify: Spec folder created with correct structure

### Test 3: Path Validation Warning
1. Configure governance.path_validation.mode = "warn"
2. Ask OmO to create a file in /tmp/test.txt
3. Verify: Warning appears but file is created

### Test 4: Changelog Creation
1. Make several file changes in a session
2. End the session
3. Verify: Changelog entry created with all modified files
```

### 7.4 Performance Testing

**Benchmark: Hook Overhead**

```typescript
describe("performance", () => {
  it("governance hooks add <5ms overhead per tool call", async () => {
    const hook = createGovernancePathValidatorHook(mockCtx);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await hook["tool.execute.before"]({ tool: "write" }, { title: "src/file.ts" });
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 1000).toBeLessThan(5); // <5ms per call
  });
});
```

---

## 8. Recommendations

### 8.1 Critical Path Updates

Based on this analysis, the **critical path** should be updated:

```
ORIGINAL:
Phase 1 (Hooks) → Phase 2 (Agents) → Phase 3 (Tools) → Phase 4 (Workflows)

RECOMMENDED:
1. Task 3.6 (Agent Loader Extension) - FIRST, unblocks agents
2. Phase 1 (Hooks) - Foundation
3. Phase 3.4-3.5 (Hook/Tool Wiring) - Integration
4. Task 3.7 (OmO Prompt Awareness) - CRITICAL for tool usage
5. Phase 2 (Agents) - After loader works
6. Phase 3.1-3.3 (Tool Creation) - Can parallel with hooks
7. Phase 4 (Workflows) - After all components work
8. Phase 5 (Testing) - Final validation
```

### 8.2 Architecture Decisions (ADR Candidates)

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| **Agent Location** | `.claude/agents/` vs `.opencode/agent/` | Extend loader for both | Backward compatibility |
| **Linear Integration** | MCP vs SDK vs Native | Custom tools with SDK | Full control, no MCP dependency |
| **Path Validation Mode** | Block vs Warn | Default to Warn | Less disruptive, still visible |
| **Changelog Trigger** | Per-file vs Per-session | Per-session | Less noise, more useful |
| **Hook Order** | First vs Last | Last | Let existing hooks run first |
| **Agent Naming** | Plain vs Prefixed | Plain with namespace docs | Cleaner, documented |

### 8.3 Risk Mitigation

| Risk | Mitigation | Implementation |
|------|------------|----------------|
| **Hook conflicts** | Position last, check blocked state | Code pattern in section 6.5 |
| **Performance impact** | Benchmark, async where possible | Test suite in section 7.4 |
| **User confusion** | Clear documentation, defaults | Config schema with comments |
| **Breaking changes** | Feature flags, opt-out | Governance config section |

### 8.4 Estimated Timeline Revision

| Phase | Original | Revised | Change |
|-------|----------|---------|--------|
| Phase 1: Hooks | 14h | 16h | +2h for error handling |
| Phase 2: Agents | 13h | 10h | -3h (simpler after loader) |
| Phase 3: Tools | 12h | 14h | +2h for Linear SDK |
| Phase 3.5: Integration | 14h | 18h | +4h for prompt awareness |
| Phase 4: Workflows | 7h | 7h | No change |
| Phase 5: Testing | 13h | 15h | +2h for edge cases |
| **Total** | **73h** | **80h** | **+7h** |

---

## 9. Updated Deliverables

Based on this analysis, the following updates are needed:

### 9.1 Plan Updates

1. **Add Task 3.6 to critical path** - Must complete before agent tasks
2. **Add Linear SDK dependency** - Not just MCP
3. **Add OmO prompt section updates** - Not just new `<Governance>` section
4. **Add configuration schema** - Governance options
5. **Add error handling patterns** - For all edge cases

### 9.2 Tasks Updates

1. **Split Task 2.4** - OmO prompt updates into multiple sub-tasks
2. **Add Task 3.9** - Linear SDK integration
3. **Add Task 5.4** - Edge case testing
4. **Reorder tasks** - 3.6 before 2.1-2.3

### 9.3 New ADR Required

Create ADR for:
- Agent loader extension decision
- Linear integration approach
- Path validation default mode
- Hook execution order

---

## 10. Conclusion

This comprehensive architecture review reveals that the **core approach is sound** but the **integration details need refinement**. The main gaps are:

1. **Agent loader must be extended first** - Blocks all agent work
2. **OmO prompt needs multi-section updates** - Not just adding `<Governance>`
3. **Linear integration needs custom tools** - MCP not available
4. **Error handling is underspecified** - Need graceful degradation
5. **Configuration schema needs governance section** - For user customization

With these updates, the OmO governance integration can proceed successfully. The revised timeline adds ~7 hours but significantly reduces risk of integration failures.

---

## References

- **OmO Source**: `/Users/eru/Documents/GitHub/oh-my-opencode/`
- **Our System**: `/Users/eru/Documents/GitHub/project-template/.opencode/`
- **Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
- **Spec**: `./spec.md`
- **Plan**: `./plan.md`
- **Tasks**: `./tasks.md`
