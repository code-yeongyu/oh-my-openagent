# Matrixx Architecture — Full Analysis

## 1. Philosophy Behind Matrixx for Software Development

Matrixx is built on the philosophy that **software development is a team sport, not a solo activity** — even when the "team" is all AI. The core principles:

**Role-Based Specialization**: Instead of one general-purpose AI doing everything, Matrixx decomposes the development process into distinct roles (Architect, Developer, Security Auditor, Frontend Specialist, DSL Expert) — each with domain-specific skills, tools, and constraints. This mirrors how high-performing engineering teams actually work.

**Orchestration Over Monolith**: The Morpheus agent (default orchestrator) is explicitly instructed to *delegate* everything non-trivial. The architect hook actively BLOCKS orchestrators from writing code directly via `ORCHESTRATOR_DELEGATION_REQUIRED` warnings. The philosophy is: orchestrators orchestrate, workers work.

**Mandatory Quality Gates**: Quality isn't an afterthought — it's structurally enforced. The todo-continuation-enforcer ensures tasks aren't abandoned. The quality-gate hook auto-lints after every write. The software-dev skill mandates verification at every phase boundary. The review-work skill spawns 5 parallel review agents. The system is designed so you *can't* ship bad code without explicitly circumventing multiple safeguards.

**TDD as Default**: The RED-GREEN-REFACTOR cycle is embedded into the Oracle plan template itself — every generated plan includes test-first structure regardless of whether the tdd-enforcer skill is enabled. The philosophy: tests aren't optional, they're the specification.

**Continuation Over Interruption**: Matrixx aggressively prevents task abandonment. The todo-continuation-enforcer counts down 2 seconds after a session goes idle, then injects a continuation prompt if incomplete tasks remain. The matrix-loop runs iterations until completion. The system treats stopping before completion as a failure state.

---

## 2. Base Agents (14 Total)

| Agent | Role | Model | Cost | Key Trait |
|-------|------|-------|------|-----------|
| **Morpheus** | Main orchestrator (user-facing) | Claude Opus 4.6 | normal | Delegates by default, only works directly for trivial tasks |
| **Keymaker** | Autonomous deep worker | GPT 5.3 Codex | normal | "KEEP GOING" — explores before assuming, never asks permission |
| **Atlas/Architect** | Master orchestrator (subagent) | Claude Sonnet 4.6 | normal | Pure conductor — denied write tools, delegates ALL work via `task()` |
| **Merovingian** | Strategic advisor (Oracle) | Claude Sonnet 4.6 | expensive | Read-only, pragmatic minimalism, "one clear path" |
| **Oracle** | Planning agent | dynamic | expensive | Interview mode → plan generation → structured output with RED-GREEN-REFACTOR |
| **Cipher** | DSL engineering specialist | varies | normal | 11 DSL skills, delegates codegen to language-specific experts |
| **Sentinel** | Security auditor | varies | normal | Read-only, 9 security skills, phased scanning (SAST/DAST/crypto/infra) |
| **Sati** | Frontend specialist | Claude Sonnet 4.6 | normal | Self-contained (no delegation), 8 frontend skills, browser verification |
| **Seraph** | Pre-planning consultant | varies | normal | Classifies intent, identifies ambiguities, prevents AI failure patterns |
| **Smith** | Plan reviewer | varies | normal | Approval-biased, validates executability, outputs [OKAY] or [REJECT] |
| **Operator** | External research (Librarian) | varies | cheap | Web search, documentation, mandatory citations for all claims |
| **Trinity** | Codebase explorer (Grep) | varies | free | Read-only AST/LSP/grep, structured analysis output |
| **Construct** | Multimodal analyzer | varies | cheap | Read-only PDF/image/diagram interpretation |
| **Mouse** | Task executor | dynamic | varies | Spawned by `task()` for category-based execution, focused worker |

---

## 3. How Orchestration Is Implemented

Orchestration operates through **four interlocking systems**:

### A. The Architect Hook (Always-On Watchdog)

Located in `src/hooks/architect/`, this runs on every session:

- **Event Handler**: Listens for `session.idle`. When a subagent goes idle, checks: Is this a mission session? Are there running background tasks? Is continuation on cooldown? Then injects `MISSION_CONTINUATION_PROMPT` to keep work moving.
- **Tool-Execute-Before**: Intercepts Write/Edit tools and injects `ORCHESTRATOR_DELEGATION_REQUIRED` warnings — actively preventing orchestrators from doing implementation work.
- **Tool-Execute-After**: After task completion, collects git diffs, extracts subagent session IDs, reads mission state, and appends progress reminders.
- **Mission Continuation Injector**: The engine — resolves model, checks for running tasks, calls `ctx.client.session.promptAsync()` with continuation prompts.

### B. Todo Continuation Enforcer (Task Completion Guarantee)

Located in `src/hooks/todo-continuation-enforcer/` (14 files, ~2000 LOC):

```
session.idle event
  → Safety checks (not recovering, no abort, no background tasks, agent has write access, incomplete todos exist, not within 30s cooldown, < 5 consecutive failures)
  → 2-second countdown with toast notification
  → Inject CONTINUATION_PROMPT via session.promptAsync()
  → Track failure count (max 5)
```

### C. Matrix Loop (Self-Referential Dev Loop)

Located in `src/hooks/matrix-loop/`:

```
Start: iteration=1, max_iterations, completion_promise
  → session.idle: check recovery state, validate session, detect completion
  → Completion verification: optionally spawn separate agent to review session history
  → On failure: send feedback + retry (up to maxRetries)
  → On success: increment iteration, inject continuation prompt
  → On max iterations: show warning, stop
```

### D. Task Delegation Flow (The `task()` Tool)

Located in `src/tools/delegate-task/`:

```
User message → Morpheus (orchestrator)
  → task(category="source", load_skills=["git-master"], prompt="...")
    → category-resolver: resolve model, agent, prompt append
    → Execution routing:
        - session_id present → continuation (resume existing)
        - category → spawn Mouse agent with category-specific config
        - subagent_type → spawn named agent directly
    → System content assembly: skill instructions + category prompt
    → Execute (background or sync)
```

**8 routing categories**: `construct`, `source`, `deep-jack`, `matrix-bend`, `bullet-time`, `blue-pill`, `red-pill`, `broadcast` — each mapped to a specific model, temperature, and agent configuration.

---

## 4. Basic Workflows

### Workflow 1: Standard Development (via software-dev skill)

6-phase pipeline with task-size adaptivity:

| Phase | Role | Skills Loaded | Exit Criteria |
|-------|------|---------------|---------------|
| **PLAN** | Architect (Oracle) | `[]` | Approach defined, files listed, edge cases identified |
| **BUILD** | Developer (Source) | `["git-master", "tdd-enforcer"]` | Code written, tests pass via RED-GREEN-REFACTOR |
| **VERIFY** | Quality | N/A (bash) | `lint && typecheck && test && build` all pass |
| **REVIEW** | Quality (Red-Pill) | `["quality-gate", "review-work"]` | 5-agent parallel review, all PASS |
| **SECURE** | Sentinel | `["security-core", "security-sast", "security-api", "security-dependencies"]` | No CRITICAL/HIGH findings |
| **SHIP** | Developer (Bullet-Time) | `["git-master"]` | Atomic commits, PR to `dev` |

**Task size adaptivity**:

- **Small (1-2 files)**: BUILD → VERIFY → SHIP
- **Medium (3-10 files)**: PLAN → BUILD → VERIFY → REVIEW → SHIP
- **Large (10+ files)**: ALL 6 PHASES
- **Security-related**: Always includes SECURE

### Workflow 2: Parallel Exploration

Multiple `task(run_in_background=true)` calls fire simultaneously — explore/librarian agents search in parallel, results collected via `background_output()`.

### Workflow 3: Matrix Loop (Autonomous Iteration)

User invokes `/matrix-loop` → system creates iterations until completion verification passes → each iteration spawns work, verifies results, feeds back failures.

### Workflow 4: Review Pipeline (via review-work skill)

5 parallel sub-agents launched:

1. **Goal Verifier**: Checks original requirements against implementation
2. **QA Executor**: Hands-on testing (Playwright for frontend, curl for API)
3. **Code Reviewer**: Quality, patterns, maintainability
4. **Security Auditor**: Vulnerability scanning
5. **Context Miner**: Cross-references git/Slack/Notion for hidden context

All must PASS for review to pass.

---

## 5. How TDD Is Triggered and Used

TDD operates through **three mechanisms**:

### A. Oracle Plan Template (Always-On)

When the Oracle generates plans, each TODO follows RED-GREEN-REFACTOR structure:

```
- [ ] RED: Write failing test first → `bun test [file]` must FAIL
- [ ] GREEN: Implement minimum code → `bun test [file]` must PASS
- [ ] REFACTOR: Clean up while keeping green → `bun test [file]` still PASS
```

This means TDD is embedded in plans **regardless of config**.

### B. TDD Enforcer Skill (Opt-In)

Config: `"tdd_enforcer": { "enabled": true }` in `matrixx.json`

**Prime Directive**: "NO IMPLEMENTATION WITHOUT A FAILING TEST FIRST. Violation = automatic failure."

Enforces:

- Mandatory self-checks before each phase transition
- Bug fixes need regression tests (tombstones)
- New features need 1 test per acceptance criterion
- Hooks/tools need mocked plugin context
- Refactoring must confirm coverage first
- Evidence required: `bun test` and `bun run typecheck` output

**Anti-patterns** (all = AUTOMATIC FAILURE):

- Write implementation THEN tests
- Delete a failing test to "pass"
- Skip tests ("small change")
- Commit without test file
- Report done without running `bun test`

### C. Software-Dev Skill Pipeline (Orchestral)

Phase 2 BUILD mandates `load_skills=["git-master", "tdd-enforcer"]` with explicit instruction: "Follow tdd-enforcer: write test FIRST (RED), then minimum code (GREEN), then refactor."

### Enforcement Mechanism

The todo-continuation-enforcer ensures TDD tasks aren't abandoned. If a BUILD phase has incomplete TODOs, the 2-second countdown fires and injects continuation prompts until all test-first cycles are complete.

---

## 6. How Quality Assurance Is Orchestrated

QA operates at **four distinct layers**:

### Layer 1: Automatic Linting Hook (Always-On, Non-Blocking)

After every `write`, `edit`, or `multiedit` tool call, runs `npx biome check` on `.ts/.tsx/.js/.jsx` files with 10s timeout. If issues found, appends `⚠️ Quality Gate` warning to tool output. Never blocks execution.

### Layer 2: Quality-Gate Skill (Opt-In, Instructional)

4-step mandatory verification checklist:

| Step | Command | Requirement |
|------|---------|-------------|
| 1. Lint | `bun run lint` + `bun run lint:fix` | 0 issues |
| 2. Type Check | `bun run typecheck` | `tsc --noEmit` exits 0, no `as any` or `@ts-ignore` |
| 3. Tests | `bun test` | All pass |
| 4. Build | `bun run build` | Exits 0, `dist/index.js` exists |

Evidence format required: ✅/❌ per check with counts. Stop on failure → fix → re-run ALL.

### Layer 3: Architect Verification Reminder (Always-On for Missions)

The `VERIFICATION_REMINDER` template mandates 4 steps:

1. **Automated verification**: `lsp_diagnostics` on changed files, run tests, run build/typecheck
2. **Manual code review** (NON-NEGOTIABLE): Read EVERY changed file, cross-check claims against reality
3. **Hands-on QA determination**: Frontend→Playwright, TUI→tmux, API→curl
4. **Add QA tasks to todo** if needed

Key quote from the system: *"Subagents FREQUENTLY LIE about completion. Tests FAILING, code has ERRORS, implementation INCOMPLETE — but they say 'done'."*

### Layer 4: Todo Continuation Enforcer (Always-On for Active Missions)

Ensures quality tasks aren't abandoned. If incomplete QA tasks remain when a session goes idle, the 2-second countdown fires and forces continuation.

### When Quality-Gate Skill Is Used

The quality-gate skill is loaded via `load_skills=["quality-gate"]` in delegation tasks during the REVIEW phase of the software-dev pipeline. It's also available on-demand via `skill(name="quality-gate")` when an agent wants to verify its work. The auto-linting hook runs independently of the skill — it's always active.

---

## 7. How to Improve the Software Development Workflow with More Skills

Based on the architecture, here are high-impact skill additions:

### A. Performance Profiling Skill

- **Trigger**: "profile", "benchmark", "optimize performance"
- **Domain**: Load testing, flame graphs, Core Web Vitals, memory profiling
- **Integration**: SECURE phase could expand to include performance gates

### B. Documentation Generation Skill

- **Trigger**: "document", "write docs", "API reference"
- **Domain**: Auto-generate JSDoc/TSDoc, README sections, API documentation from code
- **Integration**: New DOCS phase between REVIEW and SHIP

### C. Migration Skill

- **Trigger**: "migrate", "upgrade", "refactor schema"
- **Domain**: Database migrations, API versioning, dependency upgrades with backward compatibility
- **Integration**: Specialized workflow with rollback verification

### D. Integration Testing Skill

- **Trigger**: "integration test", "e2e", "end-to-end"
- **Domain**: Playwright/Puppeteer orchestration, API contract testing, service mesh testing
- **Integration**: VERIFY phase expansion for complex systems

### E. Accessibility Audit Skill

- **Trigger**: "a11y", "accessibility", "WCAG"
- **Domain**: axe-core integration, screen reader testing, keyboard navigation verification
- **Integration**: Frontend SECURE phase supplement

### F. Dependency Audit Skill

- **Trigger**: "dependency audit", "supply chain", "license compliance"
- **Domain**: SBOM generation, CVE scanning, license compatibility checking
- **Integration**: SECURE phase specialization

### Implementation Pattern

Each skill follows the existing pattern in `src/features/builtin-skills/skills/`:

1. Export a `Skill` object with `name`, `description`, `template` (markdown instructions)
2. Register in `src/features/builtin-skills/skills/index.ts`
3. Add to `createBuiltinSkills()` in `src/features/builtin-skills/index.ts`
4. Optionally add Zod config schema in `src/config/schema/` if skill needs configuration
5. Add to relevant `load_skills` arrays in the software-dev pipeline

---

## 8. Why This Specific Agent Team Was Selected

The 14-agent roster maps to **distinct cognitive functions** in software development:

### The Orchestration Layer (3 agents)

- **Morpheus** (user-facing orchestrator): The "face" — translates user intent into delegation decisions. Chosen because orchestration requires the strongest model (Claude Opus 4.6) for understanding nuance.
- **Atlas/Architect** (subagent orchestrator): Pure conductor — denied write tools to prevent "orchestrator doing implementation" anti-pattern. Exists to enforce the separation of concerns.
- **Mouse** (task executor): The "hands" — spawned per-task with category-specific config. Exists because workers should be stateless and disposable.

### The Intelligence Layer (3 agents)

- **Merovingian** (strategic advisor): Read-only consultation for hard architecture decisions. "Expensive" cost signals: only use when the problem truly warrants it.
- **Oracle** (planner): Interview-mode plan generation. Structured output with RED-GREEN-REFACTOR built into plans.
- **Seraph** (pre-planning): Classifies intent BEFORE Oracle plans. Prevents AI failure patterns (ambiguity, scope creep, false assumptions).

### The Review Layer (2 agents)

- **Smith** (plan reviewer): Approval-biased validator. Outputs [OKAY] or [REJECT] — no "looks good but..." cop-outs.
- **Sentinel** (security auditor): Read-only, 9 security skills. Exists because security can't be an afterthought — it needs dedicated attention.

### The Specialist Layer (3 agents)

- **Sati** (frontend specialist): Self-contained with 8 frontend skills + browser verification. "Self-contained" means it doesn't delegate — it does the full stack frontend work itself.
- **Cipher** (DSL engineering): 11 DSL skills for grammar design, parser engineering, code generation. Niche but critical for language work.
- **Construct** (multimodal): PDF/image/diagram interpretation. Exists because architecture diagrams and specs come in visual formats.

### The Research Layer (2 agents)

- **Operator** (librarian): External research with mandatory citations. "Cheap" cost signals: use liberally for documentation lookup.
- **Trinity** (codebase explorer): Read-only grep/AST/LSP. "Free" cost signals: fire in parallel, use as a peer tool.

### The Design Rationale

Each agent was selected to fill a **specific gap** in the development workflow that general-purpose agents handle poorly:

- Security needs dedicated attention → Sentinel
- Frontend has unique verification needs (browser) → Sati
- DSL work requires specialized knowledge → Cipher
- Planning needs structured interview → Oracle
- Plans need validation → Smith
- Pre-planning catches ambiguities → Seraph
- Research needs citations → Operator
- Codebase search needs speed → Trinity

The cost tiers (free → cheap → normal → expensive) ensure agents are used appropriately — don't burn Opus tokens on grep tasks.

---

## 9. Comparison with Competing Plugins

| Feature | **Matrixx** | **oh-my-openagent** | **oh-my-opencode-slim** | **DevSquad** | **opencode-orchestrator** | **opencode-superpowers** |
|---|---|---|---|---|---|---|
| **Stars** | ~100 | ~500 | 6,089 ⭐ | 29 | 186 | 3 |
| **Agent Count** | **14** | 11 | 7+1 | 9 | 4 | 0 (skills only) |
| **Hook Count** | ~52 | 54+ (61 w/ Team Mode) | Unknown | Similar to oh-my | Unknown | Unknown |
| **Built-in Skills** | 31 | Shared library | LazySkills TUI | Limited | None | 14 |
| **TDD Enforcement** | ✅ Mandatory (opt-in) | ❌ | ❌ | ❌ | ❌ | ✅ test-driven skill |
| **Quality Gate** | ✅ 4-step checklist | ❌ | ❌ | ❌ | ❌ | ✅ verification skill |
| **Security Auditing** | ✅ Sentinel + 9 skills | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Code Review** | ✅ 5-agent parallel | ❌ | ❌ | ❌ | ❌ | ✅ code-review skill |
| **Parallel Agents** | ✅ Background tasks | ✅ Team Mode (up to 8) | ✅ Background agents | ✅ Parallel | ❌ Sequential | N/A |
| **Self-Loop** | Matrix Loop + todo continuation | Ralph Loop | Deepwork workflow | upup-loop | Mission Loop | N/A |
| **Config System** | Zod v4 + JSONC + 10 profiles | Zod + JSONC | Presets | Zod + JSONC | JSON | None |
| **MCP Servers** | 4 (websearch, context7, grep_app, document-reader) | 5 (+codegraph, git_bash) | 5 | 5 | Unknown | None |
| **Platform Packages** | 7 + 4 baseline | Multiple editions | ❌ | ❌ | ❌ | ❌ |
| **Test Coverage** | 262 files (~144k LOC) | Unknown | Unknown | Unknown | Unknown | Unknown |

### Matrixx Unique Advantages

- **Only plugin with Sentinel** (security auditing) — no competitor has dedicated security
- **Only plugin with Cipher** (DSL engineering) — specialized for language work
- **Only plugin with Sati** (frontend specialist with bundled skills + browser verification)
- **Most sophisticated config**: 8 profiles, JSONC, Zod v4, auto-migration
- **BDD comments** (`//#given //#when //#then`) — no competitor enforces this
- **Dead code removal** (`/remove-deadcode`) — unique command
- **Skill-embedded MCPs** — skills can bring their own MCP servers
- **Highest test coverage** in the ecosystem (262 files)

### Matrixx Weaknesses vs Competitors

- **Fewer stars** (100 vs 6,089 for oh-my-opencode-slim)
- **No floating UI companion** (slim has Companion desktop UI)
- **No multi-LLM consensus** (slim has Council for cross-model verification)
- **No external memory system** (orchestrator has Ebbinghaus memory with fading notes)
- **Fewer MCP servers** (4 vs 5 in most competitors — missing codegraph, git_bash)
- **No Team Mode equivalent** (oh-my-openagent has lead + 8 parallel workers)

### Architectural Differentiation

Matrixx's **3-tier hook system** (Core → Continuation → Skill) with safe-creation pattern is the most structured in the ecosystem. The **category + skill delegation system** with mandatory `load_skills` parameter ensures subagents are always properly equipped. The **todo-continuation-enforcer** with its 2-second countdown + 5-failure circuit breaker is the most aggressive task-completion mechanism available.

The closest competitor is **oh-my-openagent** (code-yeongyu/oh-my-openagent) which shares similar architectural DNA (Ralph Loop ≈ Matrix Loop, Todo Enforcer ≈ Todo Continuation Enforcer, 5 categories ≈ 8 categories) — but lacks the specialist agents (Sentinel, Cipher, Sati) and the structured quality pipeline.
