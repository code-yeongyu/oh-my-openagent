# Model Settings Compatibility Resolver Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize compatibility handling for `variant` and `reasoningEffort` so an already-selected model receives the best valid settings for that exact model.

**Architecture:** Introduce a pure shared resolver in `src/shared/` that computes compatible settings and records downgrades/removals. Integrate it first in `chat.params`, then keep Claude-specific effort logic as a thin layer rather than a special-case policy owner.

**Tech Stack:** TypeScript, Bun test, existing shared model normalization/utilities, OpenCode plugin `chat.params` path.

---

### Task 1: Create the pure compatibility resolver

**Files:**
- Create: `src/shared/model-settings-compatibility.ts`
- Create: `src/shared/model-settings-compatibility.test.ts`
- Modify: `src/shared/index.ts`

- [ ] **Step 1: Write failing tests for exact keep behavior**
- [ ] **Step 2: Write failing tests for downgrade behavior (`max` -> `high`, `xhigh` -> `high` where needed)**
- [ ] **Step 3: Write failing tests for unsupported-value removal**
- [ ] **Step 4: Write failing tests for model-family distinctions (Opus vs Sonnet/Haiku, GPT-family variants)**
- [ ] **Step 5: Implement the pure resolver with explicit capability ladders**
- [ ] **Step 6: Export the resolver from `src/shared/index.ts`**
- [ ] **Step 7: Run `bun test src/shared/model-settings-compatibility.test.ts`**
- [ ] **Step 8: Commit**

### Task 2: Integrate resolver into chat.params

**Files:**
- Modify: `src/plugin/chat-params.ts`
- Modify: `src/plugin/chat-params.test.ts`

- [ ] **Step 1: Write failing tests showing `chat.params` applies resolver output to runtime settings**
- [ ] **Step 2: Ensure tests cover both `variant` and `reasoningEffort` decisions**
- [ ] **Step 3: Update `chat-params.ts` to call the shared resolver before hook-specific adjustments**
- [ ] **Step 4: Preserve existing prompt-param-store merging behavior**
- [ ] **Step 5: Run `bun test src/plugin/chat-params.test.ts`**
- [ ] **Step 6: Commit**

### Task 3: Re-scope anthropic-effort around the resolver

**Files:**
- Modify: `src/hooks/anthropic-effort/hook.ts`
- Modify: `src/hooks/anthropic-effort/index.test.ts`

- [ ] **Step 1: Write failing tests that codify the intended remaining Anthropic-specific behavior after centralization**
- [ ] **Step 2: Reduce `anthropic-effort` to Claude/Anthropic-specific effort injection where still needed**
- [ ] **Step 3: Remove duplicated compatibility policy from the hook if the shared resolver now owns it**
- [ ] **Step 4: Run `bun test src/hooks/anthropic-effort/index.test.ts`**
- [ ] **Step 5: Commit**

### Task 4: Add integration/regression coverage across real request paths

**Files:**
- Modify: `src/plugin/chat-params.test.ts`
- Modify: `src/hooks/anthropic-effort/index.test.ts`
- Add tests only where needed in nearby suites

- [ ] **Step 1: Add regression test for non-Opus Claude with `variant=max` resolving to compatible settings without ad hoc path-only logic**
- [ ] **Step 2: Add regression test for GPT-style `reasoningEffort` compatibility**
- [ ] **Step 3: Add regression test showing supported values remain unchanged**
- [ ] **Step 4: Run the focused test set**
- [ ] **Step 5: Commit**

### Task 5: Verify full quality bar

**Files:**
- No intended code changes

- [ ] **Step 1: Run `bun run typecheck`**
- [ ] **Step 2: Run a focused suite for the touched files**
- [ ] **Step 3: If clean, run `bun test`**
- [ ] **Step 4: Review diff for accidental scope creep**
- [ ] **Step 5: Commit any final cleanup**

### Task 6: Prepare PR metadata

**Files:**
- No repo file change required unless docs are updated further

- [ ] **Step 1: Write a human summary explaining this is settings compatibility, not model fallback**
- [ ] **Step 2: Document scope: Phase 1 covers `variant` and `reasoningEffort` only**
- [ ] **Step 3: Document explicit non-goals: no model switching, no automatic upscaling in Phase 1**
- [ ] **Step 4: Request review**
