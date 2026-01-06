# Upstream Fork Sync

**Linear Issue**: [LIF-111](https://linear.app/lifelogger/issue/LIF-111/sync-fork-with-upstream-code-yeongyuoh-my-opencode-397-commits)
**Created**: 2026-01-02
**Status**: Ready for Planning

## Overview

Comprehensive synchronization of our fork (DomGrieco/oh-my-opencode) with the upstream repository (code-yeongyu/oh-my-opencode). The fork has diverged significantly: 397 commits behind upstream/master and 118 commits ahead with unique customizations. This sync must integrate all upstream features and bug fixes while preserving our valuable customizations (Linear integration, documentation system, custom agents).

## Problem Statement

### Current State

Our fork is significantly out of sync with upstream:
- **397 commits behind** upstream/master (versions v2.1.x through v2.12.1)
- **118 commits ahead** (our unique Linear integration, spec workflow, documentation system)
- **~164 new files** in upstream (CLI system, Sisyphus agent, skill-MCP integration)
- **~504 files** with differences between branches
- **~110 modified files** with potential merge conflicts

### Issues

1. **Missing Critical Features**: Fork lacks Sisyphus agent, CLI system, skill-MCP integration, and 10+ new hooks
2. **Missing Bug Fixes**: Recovery pipeline fixes, memory leak patches, Windows fixes, context duplication fix
3. **Potential Instability**: Outdated recovery mechanisms may cause session crashes
4. **Divergent Architecture**: OmO agent in our fork vs Sisyphus in upstream - need reconciliation strategy
5. **Directory Structure Conflict**: Upstream removed `.claude/` in favor of `.opencode/`, but we use both
6. **Risk of Losing Customizations**: Merge could accidentally overwrite our Linear integration, documentation, custom agents

## User Stories

### US-1: As a developer using the fork
I want access to all upstream features (Sisyphus, CLI, skill-MCP)
So that I can leverage the latest capabilities without switching to upstream

**Acceptance Criteria:**
- [ ] Sisyphus agent available and functional
- [ ] CLI commands work (`omo run`, `omo doctor`, `omo install`)
- [ ] Skill-MCP integration operational
- [ ] All 10+ new hooks integrated

### US-2: As a maintainer of the fork
I want our unique customizations preserved
So that Linear integration, documentation system, and custom agents continue working

**Acceptance Criteria:**
- [ ] Linear tools functional (branch, update_status, create_issue, etc.)
- [ ] `.cursor/memory/` documentation preserved
- [ ] `.cursor/specs/` folder system intact
- [ ] Custom agents in `.opencode/agent/` working
- [ ] Workflow state management operational

### US-3: As a user experiencing bugs
I want all upstream bug fixes applied
So that session recovery, memory management, and Windows compatibility work correctly

**Acceptance Criteria:**
- [ ] Recovery pipeline with early exit and proper charsPerToken
- [ ] Background agent TTL pruning prevents memory leaks
- [ ] Windows path detection and startup fixes applied
- [ ] Context duplication reduced (~22k to ~11k tokens)
- [ ] Todo enforcer improvements (500ms grace, event-order detection)

### US-4: As a fork contributor
I want a clear understanding of what changed
So that I can maintain and extend the codebase confidently

**Acceptance Criteria:**
- [ ] CHANGELOG documenting all synced changes
- [ ] Migration notes for breaking changes
- [ ] Updated AGENTS.md reflecting new capabilities

## Requirements

### Functional Requirements

#### FR-1: Integrate Sisyphus Agent System
Upstream replaced OmO with Sisyphus as the primary orchestrator. Integration must:
- Add `src/agents/sisyphus.ts` and `src/agents/sisyphus-prompt-builder.ts`
- Add `.github/workflows/sisyphus-agent.yml` for automated development
- Integrate `src/features/builtin-commands/templates/ralph-loop.ts` for self-referential development
- Reconcile with our existing OmO configuration (potentially offer both)

#### FR-2: Integrate CLI System
New command-line interface in `src/cli/`:
- `run`: Session runner with completion detection
- `doctor`: System health checks (auth, config, dependencies, LSP, MCP, opencode, plugin, version, gh)
- `install`: Plugin installation helper
- `get-local-version`: Version information formatter
- Add `src/cli/config-manager.ts` for configuration management

#### FR-3: Integrate Skill-MCP System
New skill-embedded MCP server support:
- Add `src/features/skill-mcp-manager/` for MCP client lifecycle
- Add `src/tools/skill-mcp/` for skill_mcp tool
- Add `src/features/builtin-skills/` with Playwright skill
- Add `src/features/opencode-skill-loader/` (replaces claude-code-skill-loader)
- Update skill tool with MCP server capabilities display

#### FR-4: Integrate New Hooks
Add upstream hooks:
- `edit-error-recovery`: Handles Edit tool failures gracefully
- `auto-slash-command`: Intercepts and replaces slash commands
- `preemptive-compaction`: Automatic session compaction at token threshold (now default)
- `compaction-context-injector`: Context injection during compaction
- `empty-message-sanitizer`: Prevents API errors from empty messages
- Update `anthropic-context-window-limit-recovery` with pruning system

#### FR-5: Apply Critical Bug Fixes
Recovery pipeline fixes:
- `d4787c4`: Early exit in tool output truncation
- `dc057e9`: Restore compaction pipeline sufficient check, fix charsPerToken
- `b64b3f9`: Fix prompt_async API path parameter
- `f3db564`: Fix context duplication (22k → 11k tokens)
- `d0694e5`: Background agent TTL pruning for memory leaks
- Todo enforcer: 500ms grace period, event-order detection, model preservation
- Windows fixes: Startup crash, path detection
- Non-interactive env: Git command environment handling

#### FR-6: Preserve Fork Customizations
Must retain:
- `.cursor/memory/` documentation system (constitution, architecture, tech-stack, glossary)
- `.cursor/specs/` folder system with all existing specs
- `src/tools/linear/` with all Linear integration tools
- `src/tools/sync-fork/` for upstream sync workflow
- `src/tools/spec/` and `src/tools/project-context/`
- `src/tools/extract-learnings/` for meta-learning
- `src/tools/memory/` for memory management
- `.opencode/agent/*.md` custom agent definitions (18 agents)
- `.opencode/command/*.md` custom commands
- Changelog system in `changelog/`
- Context learnings in `context/learnings/`

#### FR-7: Handle Directory Structure Changes
Upstream removed `.claude/` directory:
- Keep `.claude/commands/` and `.claude/skills/` (Claude Code compatibility)
- Keep `.opencode/` directory structure
- Ensure loaders support both directory patterns

### Non-Functional Requirements

#### NFR-1: Build Integrity
- Build must pass after sync (`bun run build`)
- Type checking must pass (`bun run typecheck`)
- No circular dependencies introduced

#### NFR-2: Backwards Compatibility
- Existing configurations must continue working
- No breaking changes to tool APIs used by agents
- Commands and skills from both directory patterns load correctly

#### NFR-3: Documentation
- Updated AGENTS.md reflecting new capabilities
- Migration notes for any breaking changes
- Changelog entry documenting sync

#### NFR-4: Performance
- Context token usage should not increase (target: ~11k tokens baseline)
- No new memory leaks (TTL pruning must be active)

## Scope

### In Scope

**TAKE from Upstream (must sync):**

| Category | Items | Files/Directories |
|----------|-------|-------------------|
| **Sisyphus Agent** | Primary orchestrator, prompt builder, workflow | `src/agents/sisyphus.ts`, `sisyphus-prompt-builder.ts`, `.github/workflows/sisyphus-agent.yml` |
| **CLI System** | run, doctor, install, get-local-version | `src/cli/` (42 files, ~5.5k lines) |
| **Skill-MCP** | MCP client manager, skill_mcp tool, builtin skills | `src/features/skill-mcp-manager/`, `src/tools/skill-mcp/`, `src/features/builtin-skills/` |
| **New Hooks** | edit-error-recovery, auto-slash-command, preemptive-compaction, compaction-context-injector, empty-message-sanitizer | `src/hooks/` additions |
| **Recovery System** | Context pruning, deduplication, storage, supersede | `src/hooks/anthropic-context-window-limit-recovery/` |
| **Session Manager** | Session listing, filtering, storage | `src/tools/session-manager/` |
| **Builtin Commands** | init-deep, ralph-loop templates | `src/features/builtin-commands/` |
| **Plugin Loader** | Claude Code plugin loader | `src/features/claude-code-plugin-loader/` |
| **Bug Fixes** | All critical fixes listed in FR-5 | Various |
| **Documentation** | Updated READMEs, CONTRIBUTING, CLA | Root files |
| **CI/CD** | Enhanced workflows, CLA workflow | `.github/workflows/` |
| **Dependencies** | @modelcontextprotocol/sdk, js-yaml updates | `package.json`, `bun.lock` |

**KEEP (our unique value):**

| Category | Items | Files/Directories |
|----------|-------|-------------------|
| **Documentation System** | Constitution, architecture, tech-stack, glossary, decisions | `.cursor/memory/` |
| **Spec Workflow** | All spec folders, workflow state | `.cursor/specs/` (27 spec folders) |
| **Linear Integration** | All Linear tools and governance | `src/tools/linear/`, governance hooks |
| **Custom Agents** | 18 agent definitions | `.opencode/agent/*.md` |
| **Custom Commands** | superwhisper-mode, sync-fork | `.opencode/command/` |
| **Sync Fork Tool** | AI-driven sync analysis | `src/tools/sync-fork/` |
| **Meta-Learning** | Extract learnings tool, context learnings | `src/tools/extract-learnings/`, `context/learnings/` |
| **Memory Tools** | Memory management | `src/tools/memory/` |
| **Spec Tools** | Spec folder creation, project context | `src/tools/spec/`, `src/tools/project-context/` |
| **Changelog System** | Session changelogs | `changelog/` |
| **Workflow Hooks** | read-before-write, workflow-state-enforcer, signal-scorer | `src/hooks/` (our additions) |

**MERGE (combine best of both):**

| File | Strategy |
|------|----------|
| `src/agents/index.ts` | Add Sisyphus, keep our agent exports |
| `src/hooks/index.ts` | Add new upstream hooks, keep our hooks |
| `src/tools/index.ts` | Add session-manager, skill-mcp, keep our tools |
| `src/features/index.ts` | Add skill-mcp-manager, builtin-skills, builtin-commands, keep orchestration |
| `package.json` | Merge dependencies, keep our scripts |
| `AGENTS.md` | Regenerate with combined capabilities |
| `src/config/schema.ts` | Merge config options |

**OmO Sections to Extract as Builder Functions** (for FR-12):

| Section | Purpose | Target Function |
|---------|---------|-----------------|
| `<Intent_Gate>` | Task classification with spec folder decisions | `buildIntentGateExtensions()` |
| `<Spec_Workflow>` | tasks.md → todos, session continuity | `buildSpecWorkflowSection()` |
| `<Governance>` | Linear tools, path validation, historian | `buildGovernanceSection()` |
| `<Decision_Matrix>` | Extended with Linear/spec handling | `buildDecisionMatrixExtensions()` |
| `<Blocking_Gates>` | Includes spec folder checks | Part of `buildIntentGateExtensions()` |
| `<Todo_Management>` | Enhanced with spec folder strategy | Part of `buildSpecWorkflowSection()` |

These sections total ~600+ lines and represent our unique value proposition. They MUST be preserved in the migration.

### Out of Scope

- Removing our customizations in favor of upstream
- Changing Linear team prefix or workflow
- Restructuring `.cursor/` directory to match upstream
- Removing Claude Code compatibility layer
- Upstream-specific branding changes (we keep our fork identity)
- CLA system (upstream-specific)
- Funding/sponsorship files

## Assumptions

1. Both codebases use compatible TypeScript and Bun versions
2. Our Linear API key will continue working with integrated tools
3. Sisyphus and OmO can coexist (user chooses via config)
4. Directory loaders will handle both `.claude/` and `.opencode/` patterns
5. Tests from upstream will pass after integration
6. No runtime API changes in OpenCode that break either codebase

## Dependencies

### Technical Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| @modelcontextprotocol/sdk | Skill-MCP integration | From upstream |
| js-yaml | Skill frontmatter parsing | From upstream |
| Bun | Runtime and build | >=1.0.0 |
| OpenCode | Host platform | >=1.0.132 |

### External Dependencies

- Linear API (for our Linear integration)
- GitHub API (for Sisyphus workflow, our sync-fork)
- Various auth providers (Anthropic, Google, OpenAI)

## Success Criteria

### Quantitative

- [ ] 0 TypeScript errors after sync
- [ ] 0 build failures
- [ ] All upstream tests pass (where applicable)
- [ ] Context tokens ≤ 12k at startup (improved from 22k)
- [ ] 100% of our Linear tools functional
- [ ] 100% of our spec folders preserved

### Qualitative

- [ ] Sisyphus agent can be invoked and completes tasks
- [ ] CLI commands produce expected output
- [ ] Skill-MCP loads Playwright skill successfully
- [ ] Recovery pipeline handles token limits gracefully
- [ ] Windows users can start the plugin without crashes
- [ ] Background tasks don't accumulate memory over time

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Merge conflicts in core files | High | High | Use semantic merge, review file by file |
| Breaking our Linear integration | Medium | High | Test all Linear tools post-sync |
| Sisyphus/OmO conflict | Medium | Medium | Make both available via config toggle |
| Missing edge case fixes | Medium | Medium | Run upstream test suite |
| Build failures from dependency conflicts | Medium | High | Resolve package.json conflicts first |
| Loss of spec folders | Low | High | Backup before sync, verify after |
| Performance regression | Low | Medium | Benchmark context tokens before/after |

## Design Decisions

### DD-1: Agent Architecture Migration Strategy (REVISED 2026-01-06)
**Decision**: Migrate OmO to Sisyphus base architecture + fork-specific extensions
**Context**: Upstream uses Sisyphus with a dynamic prompt builder pattern. Our OmO has extensive customizations (spec-driven workflow, Linear integration, governance) that are unique to our fork. Maintaining two completely separate agents creates long-term maintenance burden.

**Options Considered**:
1. Replace OmO with Sisyphus entirely ❌
   - Loses all our spec-driven workflow, Linear integration, governance
   - Unacceptable loss of functionality
   
2. Keep OmO completely separate from Sisyphus ❌
   - Every upstream Sisyphus improvement requires manual porting
   - Double maintenance burden grows over time
   - Sync confusion increases with each update
   
3. Offer both via configuration (original plan) ⚠️
   - Provides flexibility but doubles maintenance
   - Users confused about which to use
   - Doesn't solve long-term sync problem
   
4. **Migrate to Sisyphus base + fork extensions (CHOSEN)** ✅
   - Adopt Sisyphus's dynamic prompt builder architecture
   - Extract our customizations into composable builder functions
   - OmO = Sisyphus base + our fork-specific extensions
   - Future syncs become cherry-picks, not rewrites

**Rationale**: Option 4 provides the best long-term maintainability:
- Upstream changes to Sisyphus base auto-apply
- Our fork-specific extensions remain isolated in separate files
- Single orchestrator architecture (OmO) built on proven foundation
- Reduces sync complexity for future updates
- Preserves all our unique functionality (spec workflow, Linear, governance)

**Architecture**:
```
src/agents/
├── sisyphus.ts                    # FROM UPSTREAM (sync-able)
├── sisyphus-prompt-builder.ts     # FROM UPSTREAM (sync-able)  
├── sisyphus-fork-extensions.ts    # OUR ADDITIONS (fork-only, NEVER synced)
│   ├── buildGovernanceSection()
│   ├── buildSpecWorkflowSection()
│   ├── buildLinearIntegrationSection()
│   └── buildDecisionMatrixExtensions()
└── omo.ts                         # THIN WRAPPER
    └── createOmoAgent() = createSisyphusAgent() + forkExtensions
```

**Key Principle**: Files from upstream stay unmodified. Our customizations live in fork-only files.

**Dependency Analysis Findings** (see `context/memory/omo-sisyphus-dependency-analysis.md`):

A detailed analysis of OmO's 21 sections (~1125 lines) revealed:
1. **Taxonomy Coupling**: Task types, scope levels defined in Intent_Gate but referenced across 5+ sections
2. **Cyclic Dependency**: Todo_Management ⇄ Spec_Workflow (mutual references)
3. **Decision_Matrix Drift Risk**: Maintained separately from Intent_Gate, no consistency mechanism

**Our Approach: Incremental Extension (not Full Decomposition)**

The analysis recommends 10-20h for full modular decomposition. However, we're doing **targeted extension extraction** instead:

| Section | Sisyphus Has? | Our Approach |
|---------|---------------|--------------|
| Intent_Gate | ✅ Phase 0 | Add spec folder decisions only |
| Todo_Management | ✅ Task_Management | Add spec-specific strategy table |
| Blocking_Gates | ✅ Hard Blocks | Add GATE 2.5 + spec checks |
| Spec_Workflow | ❌ No | Full extraction (fork-unique) |
| Governance | ❌ No | Full extraction (fork-unique) |
| Decision_Matrix | ✅ Tool Selection | Add Linear/spec entries |

This approach is faster (6h vs 10-20h) while preserving all unique functionality. A follow-up architecture cleanup phase (4-8h) can address the deeper coupling issues identified in the analysis.

### DD-2: Directory Structure Preservation
**Decision**: Keep both `.claude/` and `.opencode/` directories
**Context**: Upstream removed `.claude/` but we use it for Claude Code compatibility
**Options Considered**:
1. Follow upstream, remove `.claude/`
2. Keep both directories
**Rationale**: Claude Code users expect `.claude/` paths. Our loaders already support both. No benefit to removing.

### DD-3: Merge Strategy
**Decision**: Cherry-pick critical fixes first, then feature branches
**Context**: 397 commits is too many to merge at once
**Options Considered**:
1. Single large merge
2. Phased cherry-picks
3. Rebase onto upstream
**Rationale**: Phased approach allows testing between merges, reduces risk of cascading failures.

## Open Questions

1. **Sisyphus vs OmO Default**: Should Sisyphus become the default orchestrator, or should OmO remain default for our fork?
2. **CLI Branding**: Should CLI commands be `omo` or `oh-my-opencode` for our fork?
3. **Test Coverage**: Should we adopt upstream's test suite wholesale, or maintain separate tests for our customizations?
4. **CLA Process**: Do we need a CLA for fork contributions, or is upstream's sufficient?

## Appendix

### A. Upstream Version History (Key Releases)

| Version | Key Changes |
|---------|-------------|
| v2.12.1 | Todo enforcer 500ms grace period |
| v2.12.0 | Edit error recovery hook |
| v2.11.0 | Ralph loop completion detection |
| v2.10.0 | Skill-MCP integration, preemptive compaction default |
| v2.9.x | Sisyphus agent, init-deep restructure |
| v2.8.x | DCP for compaction, truncation recovery |
| v2.4.0 | Preemptive compaction feature |
| v2.3.0 | Sisyphus introduction |
| v2.2.x | LSP, tool improvements |
| v2.1.x | Google auth, background agent fixes |
| v2.12.4 | Fix Planner-Sisyphus visibility for OpenCode 1.1.1 |
| v2.13.0 | Slashcommand options/caching, Gemini quota routing, ultrawork improvements |
| v2.13.1 | Skip permission migration for Claude Code agents, /refactor command |
| v2.13.2 | Prevent recursive subagents, English language policy |

---

## Addendum: New Changes Since Jan 2, 2026 (106 Commits)

**Last Analyzed**: 2026-01-06
**New Commits Since Spec Creation**: 106 commits

### P0 - CRITICAL: OpenCode 1.1.1 Permission System Compatibility

The most significant change requiring immediate attention is **OpenCode v1.1.1 permission system overhaul**:

| Commit | Description | Files |
|--------|-------------|-------|
| 09f72e2 | feat: OpenCode v1.1.1 permission system compatibility (#489) | `src/shared/opencode-version.ts`, `src/shared/permission-compat.ts`, agents |
| 4e30f83 | feat(compat): add OpenCode 1.1.1 permission system compatibility | 20+ agents updated, new compat layer |
| 0d0ddef | fix: implement proper version-aware permission format | Version detection logic |
| 6c3ef65 | fix: add runtime migration for user agent configs | Config handler updates |
| 8f2209a | fix: proper OpenCode v1.1.1 permission migration (#490) | Final migration fixes |
| 9d13c6c | fix(config): skip permission migration for Claude Code agents | Edge case handling |

**Impact**: All agents must use the new permission format. The compat layer detects OpenCode version and applies appropriate format.

**New Files Required**:
- `src/shared/opencode-version.ts` - Version detection utilities
- `src/shared/permission-compat.ts` - Permission format converter

### P0 - CRITICAL Bug Fixes (Since Spec)

| Commit | Description | Priority |
|--------|-------------|----------|
| 4a38e70 | fix(session-notification): use node:child_process to avoid Bun shell GC crash (#543) | P0 |
| 375e7f7 | fix: prevent background agents from spawning recursive subagents via call_omo_agent (#536) | P0 |
| ad44af9 | fix: load skill content via lazyContentLoader in slashcommand tool | P1 |
| d331b48 | fix: verify zsh exists before using it for hook execution (#544) | P1 |
| 2064568 | fix: correct spawn mock type in session-notification test | P2 |

### P1 - HIGH: New Features to Integrate

| Commit | Description | Files |
|--------|-------------|-------|
| f25f7ed | feat(background-agent): add model-based concurrency management (#548) | `src/features/background-agent/concurrency.ts` (66 lines), schema updates |
| a2bfb5e | feat(mcp): restore Exa websearch support (#549) | MCP configuration restored |
| b78e564 | feat(builtin-commands): add /refactor command for intelligent LSP/AST-based refactoring | `templates/refactor.ts` (624 lines) |
| 4e5b356 | feat(tools): refactor slashcommand to support options and caching | Slashcommand improvements |
| bc05fb6 | feat(sisyphus): enable variant='max' for maximum reasoning effort | Agent enhancement |
| d27a1ef | feat(keyword-detector): enable variant='max' for ultrawork mode | Keyword detector improvement |
| 7a10b24 | feat: allow disabled_mcps to accept any MCP name (#513) | Config flexibility |
| 5aa0ee1 | feat: add English language policy and GitHub issue templates (#534) | Documentation |

### P2 - MEDIUM: Performance & Refactoring

| Commit | Description | Impact |
|--------|-------------|--------|
| fe11ba2 | perf(startup): parallelize command and skill loading in config-handler | Faster startup |
| 7937d72 | refactor(loaders): migrate to async-first pattern for commands and skills | Loader improvements |
| 29dbc0f | chore: cleanup agent model references and defaults (#547) | Model cleanup |

### Updated Requirements Summary

#### FR-8: OpenCode 1.1.1 Compatibility (NEW - CRITICAL)
Must implement permission system compatibility layer:
- Add `src/shared/opencode-version.ts` for version detection
- Add `src/shared/permission-compat.ts` for format conversion
- Update ALL agents to use compat layer for permissions
- Handle runtime migration for existing user configs
- Skip migration for Claude Code agents (special case)

#### FR-9: Background Agent Concurrency (NEW)
Model-based concurrency limits for background agents:
- Add `src/features/background-agent/concurrency.ts`
- Update schema with concurrency config options
- Limit concurrent agents per model to prevent rate limiting

#### FR-10: /refactor Command (NEW)
Intelligent LSP/AST-based refactoring command:
- Add `src/features/builtin-commands/templates/refactor.ts` (624 lines)
- Uses LSP for rename operations
- Uses AST-Grep for structural transformations

#### FR-11: Exa Websearch Restoration (NEW)
Exa MCP was removed then restored:
- Ensure MCP configuration includes Exa
- Update librarian agent prompt for conditional web search

#### FR-12: Agent Architecture Migration (NEW - CRITICAL)
Migrate OmO to Sisyphus base architecture with fork-specific extensions:
- Adopt Sisyphus from upstream as the base orchestrator architecture
- Create `src/agents/sisyphus-fork-extensions.ts` for our customizations
- Extract OmO's unique sections into composable builder functions:
  - `buildGovernanceSection()` - Linear tools, path validation, historian
  - `buildSpecWorkflowSection()` - tasks.md → todos, spec folder detection
  - `buildLinearIntegrationSection()` - Linear issue handling, branch naming
  - `buildDecisionMatrixExtensions()` - Extended decision matrix with Linear/spec
  - `buildIntentGateExtensions()` - Spec folder decisions by task type
- Modify OmO to compose Sisyphus base + our extensions
- Keep "OmO" as our agent name/brand (built on Sisyphus foundation)
- Ensure Ralph Loop hook works with new architecture
- Test that all spec-driven workflow commands continue to function

**Why This Matters**:
- Future upstream Sisyphus improvements apply automatically
- Our fork-specific code stays isolated and maintainable
- Reduces sync confusion and merge conflicts
- Preserves all our unique functionality

### Updated Scope - TAKE from Upstream (additions)

| Category | Items | Files/Directories | Priority |
|----------|-------|-------------------|----------|
| **OpenCode 1.1.1 Compat** | Permission system, version detection | `src/shared/opencode-version.ts`, `src/shared/permission-compat.ts` | P0 |
| **Background Concurrency** | Model-based limits | `src/features/background-agent/concurrency.ts` | P1 |
| **Refactor Command** | LSP/AST refactoring | `src/features/builtin-commands/templates/refactor.ts` | P1 |
| **Session Notification Fix** | Bun shell GC crash | `src/hooks/session-notification/` | P0 |
| **Recursive Subagent Fix** | Prevention logic | `src/tools/call-omo-agent/` | P0 |
| **Slashcommand Options** | Caching, options support | `src/tools/slashcommand/` | P2 |
| **zsh Verification** | Hook execution safety | Hook utilities | P1 |

### Updated Release Timeline

| Version | Key Changes | Status |
|---------|-------------|--------|
| v2.12.4 | OpenCode 1.1.1 Planner-Sisyphus visibility | Needs sync |
| v2.13.0 | Slashcommand options, ultrawork improvements | Needs sync |
| v2.13.1 | /refactor command, permission migration skip | Needs sync |
| v2.13.2 | Recursive subagent prevention, Exa restoration | Needs sync |

### B. File Count Summary

| Category | Upstream Adds | Ours Unique | Conflict Risk |
|----------|--------------|-------------|---------------|
| src/cli/ | 42 files | 0 | None |
| src/agents/ | 4 files | 0 | Medium (index.ts) |
| src/hooks/ | 15+ files | 3 files | Low |
| src/tools/ | 18 files | 15 files | Low |
| src/features/ | 12 files | 2 files | Medium |
| .cursor/ | 0 | 50+ files | None |
| .opencode/ | Minimal | 30+ files | Low |

### C. Our Unique Agent Definitions

Located in `.opencode/agent/`:
- agent-auditor.md
- agent-engineer.md
- ai-engineer-agentic.md
- brd-creator.md
- chat-auditor.md
- conversation-auditor.md
- devops-specialist.md
- documentation-master.md
- meta-improvement-analyst.md
- ml-engineer.md
- orchestrator.md
- project-guru.md
- quick-fixer.md
- rag-architect.md
- research.md
- rule-engineer.md
- web-design-guru.md (if present)

### D. Sync Command Reference

```bash
# Fetch upstream
git fetch upstream

# View divergence
git log --oneline HEAD...upstream/master --left-right

# Create sync branch
git checkout -b sync/lif-111-upstream

# Cherry-pick critical fixes first
git cherry-pick <commit-hash>

# Merge feature branches
git merge upstream/master --no-commit

# Resolve conflicts, test, commit
bun run typecheck && bun run build
```
