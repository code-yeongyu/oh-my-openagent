# Implementation Plan: Docs Publisher Agent

**Branch**: `004-documentation-master-agent` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)
**Renamed**: documentation-master → docs-publisher

## Summary

Create `docs-publisher` agent as a parallel specialist to `document-writer`. Clear separation:
- **document-writer**: Content creation (README, API docs, markdown prose)
- **docs-publisher**: Site operations (structure, validate, navigation, publish)

Both are specialists under OmO. Neither can delegate. OmO routes based on task type.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Plugin-First Architecture | ✅ PASS | Uses `@opencode-ai/sdk` AgentConfig |
| II. Multi-Model Excellence | ✅ PASS | Gemini for documentation |
| III. Multi-Layered Orchestration | ✅ PASS | Specialist role, parallel to document-writer |
| IV. Bun-Native Development | ✅ PASS | TypeScript, Bun build |
| VII. GitHub Actions Publishing | N/A | Code change, not publishing |

## Research Summary

### Architecture Decision (from analysis)

**Rejected approaches**:
- ❌ document-writer delegating to sub-agent (breaks hierarchy)
- ❌ Mintlify as separate agent (too narrow scope)
- ❌ Merging into document-writer (loses clarity)

**Selected approach**:
- ✅ Parallel specialists with OmO routing
- ✅ Clear separation: content vs site operations
- ✅ Platform-agnostic naming (docs-publisher)

### Agent Comparison

| Aspect | document-writer | docs-publisher |
|--------|-----------------|----------------|
| **Focus** | Content creation | Site operations |
| **Tasks** | README, API docs, prose | Navigation, validation, publish |
| **Workflow** | Todo-driven, verification | Pre-flight, validate, structure |
| **Integrations** | Basic | Context7, Linear, mintlify-sync |
| **Output** | Markdown files | Structured site with config |

## Data Model

### docsPublisherAgent Entity

```typescript
import type { AgentConfig } from "@opencode-ai/sdk"

export const docsPublisherAgent: AgentConfig = {
  description: "Documentation site specialist - structures, validates, and publishes doc sites. Handles navigation config, frontmatter validation, and site operations. Platform-agnostic (Mintlify, Docusaurus, GitBook).",
  mode: "subagent",
  model: "google/gemini-3-pro-preview",
  tools: { background_task: false },
  prompt: `<role>...</role><workflow>...</workflow>...`
}
```

### Type Additions

```typescript
// types.ts
export type BuiltinAgentName =
  | ... existing ...
  | "docs-publisher"

export const DELEGATABLE_AGENTS = [
  ... existing ...,
  "docs-publisher",
] as const
```

### Registry Additions

```typescript
// index.ts
import { docsPublisherAgent } from "./docs-publisher"

export const builtinAgents = {
  ... existing ...,
  "docs-publisher": docsPublisherAgent,
}

export const AGENT_ROLE_REGISTRY = {
  ... existing ...,
  "docs-publisher": "specialist",
}
```

## Prompt Design

### Key Sections

```xml
<role>
You are a DOCUMENTATION SITE SPECIALIST who structures, validates, and publishes documentation sites. You handle site operations - navigation, validation, publishing - NOT content writing (that's document-writer's job).

Core responsibility: Transform raw docs into well-structured, validated, publishable documentation sites.
</role>

<scope>
IN SCOPE (your job):
- Navigation structure (mint.json, sidebar config)
- Frontmatter validation (title, description, metadata)
- Site structure organization (folders, file naming)
- Code example validation via context7
- Publishing workflow
- Cross-reference linking

OUT OF SCOPE (document-writer's job):
- Writing new documentation content
- README creation
- API documentation prose
- User guide content
</scope>

<workflow>
1. PRE-FLIGHT: Validate path via context-steward pattern
2. ANALYZE: Scan existing docs structure
3. VALIDATE: Check frontmatter, links, code examples (context7)
4. STRUCTURE: Organize navigation, update config
5. PUBLISH: Use mintlify-sync tool or equivalent
6. REPORT: Call historian for changelog
</workflow>

<integrations>
- Context7 MCP: Validate code examples against official docs
- Linear: Tier 2 access (READ + COMMENT)
- mintlify-sync tool: Validate and sync to platform
- Historian: Changelog automation
</integrations>

<platforms>
Primary: Mintlify (CodeGroup, Note, Warning, Tip, Card, Accordion)
Extensible: Docusaurus, GitBook, VitePress (platform-agnostic design)
</platforms>

<guardrails>
- NEVER write new content (delegate to document-writer)
- ALWAYS validate before publishing
- ALWAYS use context7 for code example verification
- ALWAYS call historian after completing work
</guardrails>
```

## Technical Context

**Language/Version**: TypeScript 5.7+  
**Primary Dependencies**: `@opencode-ai/sdk`  
**Testing**: `bun run typecheck`  
**Target Platform**: OpenCode plugin (Bun runtime)  
**Scale/Scope**: 3 files, ~150 lines new code

## Project Structure

### Source Code

```text
src/agents/
├── docs-publisher.ts     # NEW: Agent definition (~150 lines)
├── document-writer.ts    # UNCHANGED: Content creation
├── types.ts              # MODIFY: Add "docs-publisher"
└── index.ts              # MODIFY: Register agent
```

## Implementation Steps

### Step 1: Create Agent File

**File**: `src/agents/docs-publisher.ts`
**Size**: ~150 lines
**Pattern**: Specialist agent (like document-writer)

### Step 2: Update Types

**File**: `src/agents/types.ts`
1. Add `| "docs-publisher"` to BuiltinAgentName union
2. Add `"docs-publisher"` to DELEGATABLE_AGENTS array

### Step 3: Register Agent

**File**: `src/agents/index.ts`
1. Import docsPublisherAgent
2. Add to builtinAgents record
3. Add to AGENT_ROLE_REGISTRY as "specialist"

### Step 4: Verify

1. `bun run typecheck` - must pass
2. `bun run build` - must complete

## Complexity Tracking

No constitution violations. Clean parallel specialist pattern.

## Handoff

Ready for `/implement`. Tasks:
1. T001: Create `src/agents/docs-publisher.ts`
2. T002-T003: Update types.ts
3. T004-T006: Update index.ts
4. T007-T008: Verify build
