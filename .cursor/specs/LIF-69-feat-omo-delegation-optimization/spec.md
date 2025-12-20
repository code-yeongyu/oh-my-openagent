# OmO Delegation Optimization: Cost Reduction & Enforcement

**Linear Issue**: [LIF-69](https://linear.app/lifelogger/issue/LIF-69/omo-delegation-optimization-cost-reduction-and-enforcement)
**Created**: 2025-12-19
**Status**: In Review
**Branch**: `hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement`

---

## Overview

Optimize OmO delegation to reduce Claude Opus 4.5 token costs by 50-70% through artifact-based returns, enforce documentation delegation via BLOCKING gates, and implement modular domain injection for cross-domain workflows.

### Problem Statement

1. **Documentation Bypass**: Soft guidance in OmO prompt (line 499-501) allows OmO to write documentation directly instead of delegating to document-writer, missing cost savings
2. **Cost Leakage**: Full specialist output (potentially 50K tokens) returns through OmO, negating the 7x cost differential between Opus and Gemini
3. **Identity Bias**: "You work, delegate, verify, and deliver" (line 7) creates primacy bias toward self-execution
4. **No Runtime Enforcement**: Prompt-only guidance loses to LLM defaults; no mechanism detects delegation violations

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| SC-001 | 50-70% reduction in Opus token usage for delegated tasks | Compare `omo_tokens_in_per_session` before/after |
| SC-002 | 100% delegation compliance for documentation tasks | `artifact_only_delegation_rate_pct` for doc tasks |
| SC-003 | Specialists return ≤200 tokens summary (not full content) | Truncation rate at tool boundary |
| SC-004 | Cross-domain tasks complete without context loss | `verification_pass_rate_pct` ≥80% |

---

## User Stories

### US-001: Cost-Conscious Developer
**As a** developer using OmO for complex multi-step tasks,
**I want** OmO to delegate efficiently without passing full specialist output through Opus,
**So that** I can reduce my API costs by 50-70% while maintaining task quality.

#### Acceptance Scenarios

```gherkin
Scenario: Artifact-based delegation return
  Given OmO delegates a task to implementation-specialist
  And the specialist produces 10,000 tokens of code and explanation
  When the specialist completes and returns to OmO
  Then OmO receives only a structured summary of ≤200 tokens
  And the summary includes file paths, status, and verification evidence
  And OmO can verify completion by reading artifact files
  And the full specialist output is NOT returned through OmO

Scenario: Cost tracking per delegation
  Given OmO completes a session with 5 delegations
  When the session ends
  Then a cost summary shows tokens by model (Opus vs Gemini vs Grok)
  And estimated USD cost is displayed
  And cost-per-delegation is traceable via trace_id
```

### US-002: Documentation Task Delegation
**As a** user requesting documentation work,
**I want** documentation tasks to be automatically delegated to document-writer,
**So that** I get high-quality docs from a specialized agent while saving Opus tokens.

#### Acceptance Scenarios

```gherkin
Scenario: Documentation BLOCKING gate triggers on file path
  Given OmO receives a task to update "docs/api-reference.md"
  When OmO attempts to edit the file directly
  Then the edit is BLOCKED
  And OmO is instructed to delegate to document-writer
  And the block message explains why direct docs editing is prohibited

Scenario: Documentation BLOCKING gate triggers on intent keywords
  Given OmO receives a prompt containing "write the README"
  And the prompt requests markdown output
  When OmO attempts to write documentation content
  Then OmO is guided to delegate to document-writer
  And the delegation includes context about the documentation type

Scenario: Mixed task splits code and documentation
  Given OmO receives "Fix the auth bug AND update the architecture docs"
  When OmO processes the task
  Then OmO handles the bug fix directly (or delegates to implementation-specialist)
  And documentation updates are delegated to document-writer
  And both tasks complete successfully with artifacts from each specialist

Scenario: User explicitly requests OmO write docs
  Given a user prompts "OmO, you personally write the README"
  When the documentation BLOCKING gate detects this
  Then OmO explains the delegation policy
  And offers to delegate to document-writer with OmO review
  And accepts user override only with explicit cost acknowledgment
```

### US-003: Delegation Compliance Monitoring
**As a** system administrator,
**I want** runtime enforcement of delegation policies,
**So that** cost optimization rules are reliably applied without relying on prompt adherence.

#### Acceptance Scenarios

```gherkin
Scenario: Compliance hook detects delegation violation
  Given delegation policy requires document-writer for .md files
  When OmO attempts to edit "README.md" directly
  Then the compliance hook intercepts the tool call
  And logs the violation with severity level
  And suggests the correct delegation target
  And optionally blocks the operation based on mode (warn/block)

Scenario: Repeated violations escalate
  Given OmO has been warned 3 times in the current session
  When OmO attempts another direct documentation edit
  Then the compliance hook blocks the operation
  And requires explicit user confirmation to proceed
  And logs escalation event for monitoring

Scenario: False positive handling
  Given code comments in ".ts" file contain documentation
  When OmO edits code comments as part of code fix
  Then the compliance hook allows the edit
  And does NOT trigger documentation BLOCKING
  Because inline code comments are exempt from doc-writer delegation
```

### US-004: Delegate-First Identity
**As a** user interacting with OmO,
**I want** OmO to default to delegation rather than direct execution,
**So that** specialized agents handle domain-specific work efficiently.

#### Acceptance Scenarios

```gherkin
Scenario: OmO classifies task before acting
  Given OmO receives any non-trivial task
  When OmO processes the request
  Then OmO first classifies the task type
  And evaluates whether delegation is appropriate
  And provides a one-sentence rationale for delegate vs self-execute
  And proceeds only after classification decision

Scenario: Trivial tasks remain direct
  Given OmO receives "read src/index.ts"
  When OmO classifies the task
  Then classification is TRIVIAL
  And OmO executes directly without delegation
  And no specialist is invoked for simple file reads

Scenario: Documentation task triggers mandatory delegation
  Given OmO classifies a task as documentation-related
  When the task is non-trivial documentation
  Then delegation to document-writer is MANDATORY
  And OmO cannot self-execute documentation tasks
  And this matches the behavior of frontend BLOCKING gate
```

### US-005: Domain Module Injection (P2)
**As a** developer working across different domains (code, finance, PM),
**I want** OmO to dynamically load domain-specific context,
**So that** specialists receive relevant domain knowledge without bloating OmO's base prompt.

#### Acceptance Scenarios

```gherkin
Scenario: Code domain module loads for implementation tasks
  Given OmO delegates to implementation-specialist
  When the delegation prompt is constructed
  Then code-domain module is injected with:
    | Module Content |
    | Project tech stack |
    | Coding conventions |
    | Architecture patterns |
  And the injection is ≤500 tokens

Scenario: Finance domain module loads for financial tasks
  Given OmO processes a task about "calculate trading fees"
  When domain detection identifies finance domain
  Then finance-domain module is injected with:
    | Module Content |
    | Financial terminology |
    | Precision requirements |
    | Compliance constraints |
  And the module is specific to this domain

Scenario: No domain module for generic tasks
  Given OmO processes a generic task with no domain signals
  When domain detection finds no match
  Then no domain module is injected
  And base prompt remains unchanged
  And token overhead is zero
```

### US-006: Risk-Based Model Routing (P2)
**As a** cost-conscious user,
**I want** tasks routed to models based on risk/complexity,
**So that** expensive Opus is reserved for high-risk tasks while routine work uses cheaper models.

#### Acceptance Scenarios

```gherkin
Scenario: High-risk task routes to Opus
  Given a task involves "authentication" or "payment" logic
  When risk classification runs
  Then risk level is HIGH
  And task is routed to Claude Opus (expensive, safe)
  And OmO review gate is required before writes

Scenario: Low-risk task routes to cheaper model
  Given a task involves "update button color"
  When risk classification runs
  Then risk level is LOW
  And task is routed to Gemini or Grok (cheap, fast)
  And standard artifact return applies

Scenario: Risk misclassification has guardrails
  Given risk classifier incorrectly rates a security task as LOW
  When the task touches sensitive file paths (auth/, security/, etc.)
  Then secondary path-based risk check triggers
  And task is escalated to HIGH risk
  And Opus review gate is enforced regardless of initial classification

Scenario: User overrides routing decision
  Given risk router assigns LOW risk to user's task
  When user requests "use the best model for this"
  Then user is shown cost trade-off (e.g., "3x more expensive")
  And user confirms override
  And Opus handles the task directly
```

---

## Requirements

### Functional Requirements

#### P0 - Critical (Must Have)

| ID | Requirement | Rationale |
|----|-------------|-----------|
| FR-001 | Documentation BLOCKING gate prevents OmO from directly editing docs files | Frontend BLOCKING gate (line 250-252) works; apply same pattern to docs |
| FR-002 | BLOCKING triggers on file paths: `docs/**`, `**/*.md`, `**/*.mdx`, `README*`, `CHANGELOG*`, `CONTRIBUTING*` | Objective triggers like file extensions are reliable |
| FR-003 | BLOCKING triggers on intent: doc verbs + nouns combo + markdown output request | Catches intent-based documentation tasks |
| FR-004 | Artifact-based returns: specialists return ≤200 token structured summary | Prevents 50K token responses flowing through Opus |
| FR-005 | Artifact schema includes: status, summary, files_changed, next_steps, warnings | Minimum viable information for OmO verification |
| FR-006 | Tool-boundary enforcement in `call_omo_agent` truncates oversized responses | Deterministic enforcement, not prompt-dependent |

#### P1 - High Priority (Should Have)

| ID | Requirement | Rationale |
|----|-------------|-----------|
| FR-007 | Delegation compliance hook monitors tool calls for policy violations | Runtime enforcement beyond prompt guidance |
| FR-008 | OmO identity rewrite: "orchestrate first, execute only when trivial/no specialist/cost-inefficient" | Defeats primacy bias with algorithmic contract |
| FR-009 | Per-delegation rationale requirement (1 sentence) | Reduces impulsive self-work |
| FR-010 | Cost telemetry: `omo_tokens_in/out`, `delegated_output_chars`, `estimated_cost_usd` | Measure success against 50-70% target |
| FR-011 | Session-end cost summary: tokens by model, delegation count, top 3 expensive traces | Developer visibility into optimization |

#### P2 - Medium Priority (Nice to Have)

| ID | Requirement | Rationale |
|----|-------------|-----------|
| FR-012 | Domain module loader: code, finance, PM domain contexts | Modular injection reduces base prompt bloat |
| FR-013 | Risk-based model router: HIGH/MEDIUM/LOW risk classification | Cost optimization beyond domain delegation |
| FR-014 | Sensitive path escalation: `auth/`, `security/`, `payment/` trigger Opus review | Safety guardrail for cheap model routing |
| FR-015 | User override protocol for routing decisions with cost acknowledgment | UX for edge cases |

### Non-Functional Requirements

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-001 | BLOCKING gate adds <50ms latency per tool call | Performance budget for runtime checks |
| NFR-002 | Compliance hook caches decisions per session/taskId | Avoid re-evaluation overhead |
| NFR-003 | Artifact truncation is deterministic (no LLM calls) | No additional cost from enforcement |
| NFR-004 | Cost telemetry overhead <1% of session tokens | Monitoring shouldn't negate savings |
| NFR-005 | Feature flags for each P0/P1/P2 component | Gradual rollout, easy rollback |

---

## Edge Cases & Mitigations

### Artifact-Based Returns

| Edge Case | Failure Mode | Mitigation |
|-----------|--------------|------------|
| 50K token specialist response | Cost blowup, context overflow | Hard cap at transport: truncate to first N tokens + "TRUNCATED" marker, require artifact pointers |
| Specialist fails mid-task | Partial artifacts, inconsistent state | Atomic writes (temp file + rename), status.json with step tracking, OmO reruns from last step |
| Parallel specialist conflicts | File overwrites, interleaving edits | Per-delegation workspace: `artifacts/<delegationId>/`, cross-process lockfile |
| Permission denied on write | No artifact, text fallback | Fallback hierarchy: (1) spec/artifacts root, (2) minimal diff instructions, (3) OmO performs writes |
| Ambiguous summary | OmO can't verify completion | Structured 200-token envelope: Done?, Files changed, Commands run, Artifact paths, Verification |

### Documentation BLOCKING

| Edge Case | Failure Mode | Mitigation |
|-----------|--------------|------------|
| Mixed task (bug + docs) | Gate blocks whole task or docs skipped | Split task: implementation-specialist does code, document-writer does docs |
| Docs in code comments | False positive blocking | Allowlist: inline comments ≤X lines in same file touched for fix are exempt |
| User insists "OmO write docs" | Policy conflict | Override protocol: delegate with OmO review, require "cost increase accepted" confirmation |
| Architecture docs need code | Doc-writer lacks context | Two-step: explore produces "doc brief" artifact, doc-writer writes from brief |
| Docs for non-existent code | Fabrication risk | Require "spec-first" docs type; block "as-built" docs until code exists |

### Compliance Hook

| Edge Case | Failure Mode | Mitigation |
|-----------|--------------|------------|
| OmO gaming triggers | Rephrase to avoid detection | Enforce at action-time (file paths), not keyword-time |
| False positives | Legitimate work blocked | Soft block first (warn + suggest), hard block only on repeated violation or high-risk |
| Cascade block loops | Hook blocks, OmO retries, deadlock | Per-session block budget + cooldown; after N blocks, degrade to warn-only |
| Performance overhead | Latency on every turn | Cache decisions per session; regex prefilter, LLM eval only when ambiguous |

### Risk-Based Router

| Edge Case | Failure Mode | Mitigation |
|-----------|--------------|------------|
| High-risk routed to cheap model | Security/correctness regressions | Guardrails: sensitive signals force expensive path, OmO review gate before writes |
| User disagrees with routing | Frustration | Explain trade-off in 1 line + offer override |
| Unclassifiable task | Router thrashes/defaults wrong | Default-to-safe (OmO/implementation-specialist) + clarification question |
| Router consumes tokens | Savings erased | Deterministic heuristics first, LLM only on ambiguous, cap router context |

### Cross-Cutting

| Edge Case | Failure Mode | Mitigation |
|-----------|--------------|------------|
| Stuck delegation | Background task never returns | Timeouts + heartbeat file, cancel + reroute if stale |
| Infinite delegation loops | Cost spiral | Delegation graph + max depth + "same taskId cannot be delegated twice" without confirmation |
| Context loss across boundaries | Specialist misses constraints | Task capsule artifact (requirements, constraints, file refs) read by all specialists |
| Multi-step varying risk | Wrong model for step | Step-level risk tagging, elevate only when needed |

---

## Key Entities

### DelegationPolicy
Rules mapping task intent to required agents and enforcement level.

```typescript
interface DelegationPolicy {
  id: string
  name: string
  triggers: {
    filePaths?: string[]  // glob patterns
    intentKeywords?: { verbs: string[], nouns: string[] }
    twoSignalRequired?: boolean  // require both filepath AND intent
  }
  targetAgent: string  // e.g., "document-writer"
  enforcement: "warn" | "block"
  allowOverride: boolean
  overrideRequiresConfirmation: boolean
}
```

### ArtifactResponse
Specialist output format for cost-optimized returns.

```typescript
interface ArtifactResponse {
  status: "success" | "partial" | "error"
  summary: string  // ≤200 tokens, enforced by truncation
  files_changed: string[]  // repo-relative paths
  next_steps?: string[]  // ≤5 bullets
  warnings?: string[]
  verification?: {
    lsp_diagnostics: "clean" | "errors" | "skipped"
    tests_passed?: number
    tests_total?: number
  }
  session_id: string
}
```

### DomainModule
Loadable prompt modules for different domains.

```typescript
interface DomainModule {
  id: string  // e.g., "code", "finance", "pm"
  name: string
  triggers: string[]  // keywords that activate this module
  content: string  // ≤500 tokens of domain context
  priority: number  // higher = more likely to inject if multiple match
}
```

### ModelRouter
Risk/complexity-based model selection.

```typescript
interface ModelRouterConfig {
  riskSignals: {
    high: string[]  // ["auth", "payment", "security", "migration"]
    medium: string[]  // ["database", "api", "configuration"]
    low: string[]  // ["docs", "style", "formatting"]
  }
  sensitivePathPatterns: string[]  // ["**/auth/**", "**/security/**"]
  modelByRisk: {
    high: string  // "anthropic/claude-opus-4-5"
    medium: string  // "anthropic/claude-sonnet-4"
    low: string  // "google/gemini-3-pro-preview"
  }
  requireReviewGateForCheapModel: boolean
}
```

---

## Out of Scope

1. **RL-based router training** - xRouter approach requires telemetry infrastructure not yet available
2. **Cross-process locking for artifacts** - P2 complexity, defer to phase 2
3. **Automatic cost alerting/budgets** - Useful but separate feature
4. **Token compression/prompt optimization** - LLMLingua-style approaches are separate optimization
5. **Multi-tenant cost attribution** - Single-user focus for v1

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `DelegationTracker` | Exists | `src/features/orchestration/delegation-tracker.ts` |
| `TOOL_CONFIG_BY_ROLE` | Exists | `src/config/tool-config.ts` |
| `call_omo_agent` tool | Exists | `src/tools/call-omo-agent/tools.ts` - modify for artifact truncation |
| `hook-message-injector` | Exists | `src/features/hook-message-injector/` - use for compliance messages |
| `governance-path-validator` | Exists | Extend pattern for docs BLOCKING |
| Linear MCP | Required | For issue context injection |

---

## Open Questions

1. **[NEEDS CLARIFICATION]** Should `.cursor/specs/**/*.md` files be exempt from docs BLOCKING? (They're specs, not user docs)
2. **[NEEDS CLARIFICATION]** What's the maximum acceptable retry rate for artifact-based returns before falling back to full response?
3. **[NEEDS CLARIFICATION]** Should cost telemetry be persisted across sessions for trend analysis?

---

## Appendix: Research Findings

### Cost Optimization Research

- **xRouter**: RL-based routing achieves 50-80% cost reduction
- **FrugalGPT**: Up to 98% cost reduction through inference optimization
- **Artifact pattern**: Production systems use summaries + file paths instead of full content

### Prompt Engineering Research

- **Primacy effect**: First instructions anchor LLM behavior
- **BLOCKING vs soft guidance**: BLOCKING is reliable, soft guidance is gameable
- **Identity position**: Algorithmic contracts defeat prose-based identity bias

### Current Codebase Analysis

- **Frontend BLOCKING** (omo.ts:250-252): Works via objective triggers (file extensions)
- **Documentation delegation** (omo.ts:499-501): Soft table entry, not enforced
- **Response return** (call-omo-agent:200-205): Full `responseText` returned, no truncation
- **Role-based config** (tool-config.ts): Infrastructure exists for tool restrictions
