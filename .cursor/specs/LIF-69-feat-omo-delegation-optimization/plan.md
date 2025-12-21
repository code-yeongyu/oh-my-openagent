# OmO Delegation Optimization (Cost Reduction + Enforcement) — Implementation Plan

**Linear Issue**: [LIF-69](https://linear.app/lifelogger/issue/LIF-69/omo-delegation-optimization-cost-reduction-and-enforcement)  
**Branch**: `hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement`  
**Date**: 2025-12-19  
**Spec**: `.cursor/specs/LIF-69-feat-omo-delegation-optimization/spec.md`  
**Output**: This plan defines concrete files + phased implementation for P0→P1→P2.

---

## Summary

Implement deterministic cost controls + enforcement around OmO delegation:
1) **Artifact-based returns**: enforce ≤200-token "summary envelope" for delegated agent outputs (no full-text bounce back through Opus).  
2) **Documentation BLOCKING gate**: block direct docs writes/edits unless delegated to `document-writer` (path-based + intent-based triggers).  
3) **Compliance + telemetry scaffolding**: session-scoped violation tracking, escalation (warn→block), and cheap cost proxies for visibility.

---

## Constitution Check

*Gate: must pass before implementation; re-check after P0 is complete.*

| Gate | Pass | Notes |
|------|------|-------|
| Plugin-First Architecture | ✅ | Implement as hooks/tools in `src/hooks/*`, `src/tools/*`, `src/features/*` using `@opencode-ai/plugin`. |
| Multi-Model Excellence | ✅ | Enforcement reduces Opus token usage by truncation; P2 routes via config rules. |
| Multi-Layered Agent Orchestration | ✅ | Works with existing `call_omo_agent` + `DelegationTracker`; adds policy + artifact contract. |
| Bun-Native Development | ✅ | TypeScript + Bun; no npm/yarn; config validated via existing Zod patterns. |
| Hook-Driven Enhancement | ✅ | BLOCKING implemented via `tool.execute.before` hook; compliance via hooks; minimal tool boundary changes where deterministic needed. |

No constitution violations required for P0/P1. P2 adds optional router/module loader but stays within existing patterns.

---

## Research

### Existing enforcement pattern (reference): `src/hooks/governance-path-validator/index.ts`

Key patterns to reuse:
- Runs on `"tool.execute.before"` and targets only `write`/`edit`.
- Extracts target path from tool args: `(output.args.filePath || output.args.path)`.
- Enforces with config `{ enabled, mode: "warn" | "block" | "disabled" }`.
- **Blocking behavior**: throws `new Error(...)` when mode is `block`.

Implication for LIF-69:
- Docs blocking should be a sibling hook (governance-style), using identical lifecycle + config patterns, and only doing cheap checks to stay <50ms.

### Existing "workflow gate" pattern: `src/shared/command-preflight.ts`

Key patterns to reuse:
- Deterministic, no LLM calls; returns `status: "ok" | "blocked" | "warning"` with structured issues/fixes.
- Encodes "required artifacts per workflow step".
- Suggests concrete remediation commands.

Implication for LIF-69:
- When blocking docs edits, return a clear remediation path: "delegate to `document-writer` with prefilled prompt" and optionally provide an override mechanism with explicit cost acknowledgement.

### Delegation + tool boundary surface: `src/tools/call-omo-agent/tools.ts`

Key facts:
- Synchronous mode fetches last assistant message, concatenates text parts, returns raw `responseText` + `<task_metadata>`.
- Integrates `DelegationTracker` (`src/features/orchestration/delegation-tracker.ts`) for depth/loop checks.

Implication for LIF-69:
- Best place for **deterministic truncation** is right before `output` construction in `executeSync()`.
- Enforcement must not depend on the sub-agent obeying "be brief".

### Hook interception breadth

Repo uses `"tool.execute.before"` / `"tool.execute.after"` widely (grep results include `tool-output-truncator`, `security-scanner`, `git-safety-validator`, etc.).
Implication:
- Docs blocking should live as a hook (centralized), while artifact truncation remains at tool boundary (localized, deterministic).

### Domain module loading patterns

Existing repo patterns favor:
- Configuration-driven feature enabling (disabled hooks, schema-validated config).
- Lazy/on-demand patterns in features (avoid startup bloat).
Implication:
- Domain modules should be lazy-loaded + cached (P2), injected at prompt-build time.

### Consensus vs contradictions (from parallel agent findings)

Consensus:
- **Hook boundary** for docs BLOCKING is simplest + consistent with existing governance hooks.
- **Tool boundary** for artifact truncation is required for deterministic ≤200 token guarantee.
- Prefer **pure/deterministic policy evaluation** with session-scoped caching.

Contradictions / reconciliations:
- Spec asks for intent triggers (FR-003) but "avoid brittle heuristics" is also desired. Reconcile by making intent triggers a *secondary* signal (warn/escalate) while **path triggers remain primary + blocking**.

---

## Architecture Decisions (recorded)

### AD-01: Where to implement the Documentation BLOCKING gate
**Decision**: Implement as a **new governance hook** on `"tool.execute.before"` for `write`/`edit`.  
**Why**: Central, consistent with `governance-path-validator`, applies uniformly, minimal surface area.  
**Notes**: Must be actor-aware to avoid deadlocking `document-writer` (see P0 design).

### AD-02: How to truncate artifact responses
**Decision**: Enforce at the **`call_omo_agent` tool boundary** (in `src/tools/call-omo-agent/tools.ts`) with deterministic truncation.  
**Why**: Prompt compliance is unreliable; tool boundary guarantees max output regardless of model behavior.  
**Method**: Convert raw text → `ArtifactResponse` envelope, enforce caps (token-estimate by chars), drop/replace oversized fields.

### AD-03: Domain module loading strategy
**Decision**: **Lazy load + cache** domain modules, inject only when routing requires them.  
**Why**: Avoid prompt bloat and startup overhead; consistent with feature-loader philosophy.  
**Where**: `src/features/orchestration/domain-module-loader.ts` (P2).

### AD-04: Model router integration point
**Decision**: Integrate router at **delegation decision time** (before `ctx.client.session.prompt` in `call_omo_agent`), selecting:
- which agent variant to call (preferred for v1), and/or
- which model config preset to use (if supported by config overrides).

**Why**: Router must influence actual execution cost, not just documentation.  
**Scope**: P2; keep P0/P1 stable.

---

## Data Model (TypeScript)

> These interfaces are contract-first; implementation must validate + enforce them.

### 1) `ArtifactResponse` (specialist output format)

```ts
export type ArtifactStatus = "success" | "partial" | "error"

export interface ArtifactPointer {
  path: string                 // repo-relative path (preferred)
  kind: "file" | "diff" | "log" | "report" | "link"
  description: string          // short
}

export interface ArtifactTelemetry {
  traceId: string              // correlates across hooks/tools
  sessionId: string
  fromAgent?: string
  toAgent?: string
  model?: string
  // cheap proxies (no token API dependency)
  inputChars?: number
  outputChars?: number
  truncated?: boolean
}

export interface ArtifactResponse {
  schemaVersion: "1.0"
  status: ArtifactStatus
  summary: string              // MUST be <= 200 tokens (enforced)
  filesChanged: string[]       // repo-relative paths
  warnings: string[]
  nextSteps: string[]
  artifacts: ArtifactPointer[] // pointers only; no large inline content
  telemetry: ArtifactTelemetry
}
```

### 2) `DelegationPolicy` (rules mapping intent → required agents)

```ts
export type DelegationIntent =
  | "documentation"
  | "implementation"
  | "security"
  | "testing"
  | "planning"
  | "research"
  | "unknown"

export type PolicyMode = "disabled" | "warn" | "block"

export interface DelegationPolicyMatch {
  // primary deterministic triggers
  paths?: string[]            // glob-like prefixes or patterns
  tools?: string[]            // e.g. ["write", "edit"]
  // secondary heuristic triggers
  intentKeywords?: string[]   // e.g. ["write", "update", "README", "changelog"]
  requiresMarkdown?: boolean  // markdown-like content signal
}

export interface DelegationPolicyRequirement {
  requiredAgent: string       // e.g. "document-writer"
  rationale: string           // user-facing explanation
}

export interface DelegationPolicyRule {
  id: string
  mode: PolicyMode
  match: DelegationPolicyMatch
  require: DelegationPolicyRequirement
  exceptions?: {
    allowAgents?: string[]    // e.g. ["document-writer"]
    allowPaths?: string[]     // explicit allowlist overrides
  }
  escalation?: {
    strikesToBlock: number    // e.g. 3
    windowMs: number          // e.g. session-scoped
  }
}

export interface DelegationPolicy {
  version: "1.0"
  rules: DelegationPolicyRule[]
}
```

### 3) `DomainModule` (loadable prompt modules)

```ts
export type DomainId = "code" | "docs" | "finance" | "pm"

export interface DomainModuleDetection {
  keywords: string[]          // cheap signal set
  pathPrefixes: string[]      // secondary signal set
}

export interface DomainModule {
  id: DomainId
  version: string
  maxChars: number            // enforce injection size deterministically
  detection: DomainModuleDetection
  render(context: {
    repoRoot: string
    specPath?: string
    agentType: string
    intent?: DelegationIntent
  }): string
}
```

### 4) `ModelRouterConfig` (risk-based model selection)

```ts
export type RiskTier = "low" | "medium" | "high"

export interface ModelTier {
  tier: RiskTier
  // for v1: resolve to agent name or agent config preset
  preferredAgents: string[]     // ordered fallback list
  requireReviewBeforeWrite?: boolean
}

export interface RouterRule {
  id: string
  priority: number
  when: {
    intent?: DelegationIntent
    keywords?: string[]
    pathPrefixes?: string[]
  }
  then: {
    tier: RiskTier
  }
}

export interface ModelRouterConfig {
  enabled: boolean
  tiers: ModelTier[]
  rules: RouterRule[]
  sensitivePathPrefixes: string[] // e.g. ["src/auth/", "src/hooks/security-"]
  userOverride: {
    enabled: boolean
    requireCostAck: boolean
  }
}
```

---

## Contracts (APIs + behavior)

### Artifact enforcement contract (tool boundary)

```ts
export interface ArtifactTruncationConfig {
  maxSummaryTokenEstimate: number   // 200
  maxOutputChars: number            // hard cap for tool return
  keepTaskMetadata: boolean         // keep <task_metadata> block
}

export function coerceToArtifactResponse(
  rawText: string,
  base: Omit<ArtifactResponse, "summary" | "status" | "schemaVersion"> & {
    status?: ArtifactStatus
    summaryFallback: string
  }
): ArtifactResponse

export function truncateArtifactResponse(
  response: ArtifactResponse,
  config: ArtifactTruncationConfig
): ArtifactResponse

export function formatArtifactResponseForReturn(
  response: ArtifactResponse,
  options: { includeTaskMetadata: boolean; sessionId: string }
): string
```

Behavior:
- Always return a valid `ArtifactResponse` stringified (or markdown-wrapped JSON) + optional `<task_metadata>`.
- Summary enforcement uses deterministic token estimate (chars/4 heuristic); if overflow, truncate summary and set `telemetry.truncated=true`.
- Never include large inline code; include file paths + pointers instead.

### Delegation enforcement contract (hook boundary)

```ts
export interface PolicyDecision {
  allowed: boolean
  mode: PolicyMode
  ruleId?: string
  reason: string
  remediation?: {
    delegateTo?: string
    suggestedPrompt?: string
    overrideHowTo?: string
  }
}

export function evaluateDelegationPolicy(input: {
  policy: DelegationPolicy
  tool: string
  filePath?: string
  contentSample?: string
  sessionId: string
  actorAgent?: string
}): PolicyDecision
```

Behavior:
- Primary decision from file path + tool.
- Secondary intent triggers may upgrade warn→block only after strike escalation.
- Must explicitly exempt `document-writer` (and any future doc-only agents) to avoid self-deadlock.

---

## Technical Context

| Aspect | Details |
|--------|---------|
| Language | TypeScript 5.7+ |
| Runtime / PM | Bun (`bun run typecheck`, `bun run build`) |
| SDK | `@opencode-ai/plugin` hooks + tools |
| Architecture | Plugin-first, hook-driven governance, multi-agent orchestration |
| State | Session-scoped caches via in-memory maps keyed by `sessionID` |
| Config | Zod schema in `src/config/schema.ts` (extend with feature flags + policy/router configs) |
| Testing | No dedicated test framework configured; validation via typecheck/build + manual hook/tool behavior checks |
| Performance goals | Hooks add <50ms per tool call; truncation O(n) in response size with hard caps |
| Constraints | Deterministic enforcement (no LLM calls inside hooks/tools), minimal new dependencies |

---

## Project Structure (concrete file map)

### Spec docs (this feature)

```text
.cursor/specs/LIF-69-feat-omo-delegation-optimization/
├── spec.md
├── plan.md          # (this file)
├── tasks.md
├── status.md
└── implementation/
```

### Source changes (planned)

P0/P1 core:
```text
src/
├── hooks/
│   ├── governance-docs-delegation/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── constants.ts
│   └── delegation-compliance/
│       ├── index.ts
│       ├── types.ts
│       └── constants.ts
├── tools/
│   └── call-omo-agent/
│       ├── tools.ts            # modify: enforce ArtifactResponse return
│       └── types.ts            # modify: document ArtifactResponse return semantics
├── shared/
│   ├── artifact-response.ts    # new: interfaces + truncation/coercion
│   └── index.ts                # export new shared module
├── config/
│   └── schema.ts               # modify: feature flags + policy/router configs
└── agents/
    └── omo.ts                  # modify: identity rewrite + delegation guidance (P1)
```

P2 optional:
```text
src/
└── features/
    └── orchestration/
        ├── domain-module-loader.ts  # new
        ├── model-router.ts          # new
        └── index.ts                 # export
```

Plugin wiring:
- `src/hooks/index.ts` (export new hooks)
- `src/index.ts` (register hooks conditionally by config)

---

## Phased Implementation

### P0 — Critical (FR-001…FR-006)

#### P0.1 Add artifact contract + deterministic truncation utilities
- Add `src/shared/artifact-response.ts` implementing:
  - `ArtifactResponse` types
  - `coerceToArtifactResponse()` (wrap raw text into envelope)
  - `truncateArtifactResponse()` (enforce ≤200 token-estimate summary + hard caps)
  - `formatArtifactResponseForReturn()`
- Export from `src/shared/index.ts`.

Acceptance:
- Any delegated sync response is returned as ArtifactResponse envelope.
- Envelope includes: `status`, `summary`, `filesChanged`, `warnings`, `nextSteps`, `artifacts`, `telemetry`.

#### P0.2 Enforce artifact-only return in `call_omo_agent`
- Modify `src/tools/call-omo-agent/tools.ts`:
  - After `responseText` creation, build artifact envelope + truncate.
  - Preserve `<task_metadata>` (session id) but keep it out of summary budget.
- Keep behavior deterministic; never re-prompt agent to "be shorter".

Acceptance:
- SC-003: returned content is small and stable even if subagent produced very large output.

#### P0.3 Implement Documentation BLOCKING gate (path-based + intent-based)
- Create `src/hooks/governance-docs-delegation/*`:
  - Pattern match file targets (FR-002):
    - `docs/**`, `**/*.md`, `**/*.mdx`, `README*`, `CHANGELOG*`, `CONTRIBUTING*`
  - Default mode: `block` for path matches when actor != `document-writer`.
  - Secondary intent triggers (FR-003):
    - If `write/edit` content sample looks like markdown AND recent prompt includes doc verbs/nouns, record strike.
    - Escalate to block at `strikesToBlock=3` for intent-only cases (reduces false positives).
- Wire hook in plugin init behind config flag.

Acceptance:
- Direct edits to documentation paths are blocked unless delegated to `document-writer`.
- Mixed tasks can proceed for code paths while docs are blocked with remediation text.

Dependencies:
- P0.3 depends on P0.1 only if using shared formatting for block messages (optional).

---

### P1 — High (FR-007…FR-011)

#### P1.1 Delegation compliance hook (runtime monitoring + escalation)
- Create `src/hooks/delegation-compliance/*`:
  - Track violations per session: `Map<sessionID, { countByRuleId: Record<string, number> }>`
  - Emit structured log per decision (include trace id).
  - Escalate: warn→block after N strikes (align with spec).

Acceptance:
- SC-002: doc tasks show 100% compliance (blocked unless delegated).
- Repeated bypass attempts escalate to hard block with explicit override instructions.

#### P1.2 OmO identity rewrite (reduce self-execution bias)
- Modify `src/agents/omo.ts` prompt:
  - Replace "execute-first" framing with "orchestrate-first".
  - Add explicit "classification → delegation decision → verify artifacts" loop.
  - Add a hard directive: "documentation must be delegated to document-writer".

Acceptance:
- Non-trivial docs requests trigger delegation path by default, even before hooks intervene.

#### P1.3 Telemetry (cheap, deterministic)
- Implement minimal telemetry collection:
  - In `call_omo_agent`: record `inputChars`, `outputChars`, `truncated` in ArtifactResponse.telemetry.
  - In compliance hook: record counts per rule.
  - (Optional) session-end summary hook later; keep v1 session-scoped only.

Acceptance:
- SC-001 measurable via proxies (chars per response, truncation rate, delegation count) until true token usage is available.

---

### P2 — Medium (FR-012…FR-015)

#### P2.1 Domain module loader (lazy + capped injection)
- Add `domain-module-loader.ts`:
  - Provide built-in modules: `code`, `docs`, `finance`, `pm`.
  - `render()` must cap output by `maxChars` (deterministic).
- Inject modules when building delegation prompt in `call_omo_agent` (prepend module text).

Acceptance:
- Module injection adds ≤500-token-equivalent overhead and only when matched.

#### P2.2 Risk-based model router
- Add `model-router.ts` implementing:
  - rule evaluation (priority order)
  - sensitive path escalation
  - override protocol with cost acknowledgement (logged)
- Integrate in `call_omo_agent`:
  - choose `preferredAgents` list (agent variants) for tier.
  - if no variants exist in v1, at minimum: deny downgrades for "high-risk" intents and force safe agent/model preset.

Acceptance:
- High-risk signals route to safer path and cannot silently downgrade.

---

## Verification Plan

### Type safety + build
- `bun run typecheck`
- `bun run build`

### Manual runtime checks (minimal, deterministic)
1) Attempt direct `edit` on `README.md` as non-`document-writer` agent → must block with actionable remediation.  
2) Delegate same change via `document-writer` → must allow.  
3) Force a large subagent output (e.g., verbose analysis) via `call_omo_agent` sync → returned output must remain small (ArtifactResponse).  
4) Confirm compliance escalation: repeat blocked attempt 3 times → messaging shifts to "blocked (escalated)" with override instructions.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deadlock: docs gate blocks `document-writer` | High | Actor-aware exceptions: allow `document-writer` (and future doc agents) explicitly. |
| False positives from intent triggers | Medium | Make intent-only path "warn+strike" first; hard block only after escalation; keep path-based blocking primary. |
| Path bypass (traversal, symlinks) | Medium | Normalize paths; reject traversal; consider `realpath` checks where available; keep allowlist roots. |
| Hook performance regressions | Medium | Cheap checks first; cache session decisions; avoid reading session messages on every tool call. |
| Truncation loses critical info | Medium | Force structured envelope fields; include file pointers + next steps; include trace/session metadata. |
| Over-logging / noisy UX | Low | Mode config (`warn` vs `block`), concise denial messages, structured logs only. |

---

## Effort Estimate

- P0: Short (1–4h)  
- P1: Medium (1–2d)  
- P2: Medium (1–2d), optional / can defer

---

## References (in-repo)

- Spec: `.cursor/specs/LIF-69-feat-omo-delegation-optimization/spec.md`
- Hook reference: `src/hooks/governance-path-validator/index.ts`
- Hook system events: `src/hooks/claude-code-hooks/index.ts`
- Delegation tooling: `src/tools/call-omo-agent/tools.ts`
- Delegation tracking: `src/features/orchestration/delegation-tracker.ts`
- Preflight gating pattern: `src/shared/command-preflight.ts`
- Config schema: `src/config/schema.ts`
