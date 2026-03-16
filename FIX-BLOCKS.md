# Pre-Publish BLOCK Issues: Fix ALL Before Release

Two independent pre-publish reviews (Opus 4.6 + GPT-5.4) both concluded **BLOCK -- do not publish**. You must fix ALL blocking issues below using UltraBrain parallel agents. Work TDD-style: write/update tests first, then fix, verify tests pass.

## Strategy

Use ultrawork (ulw) to spawn UltraBrain agents in parallel. Each UB agent gets a non-overlapping scope. After all agents complete, run bun test to verify everything passes. Commit atomically per fix group.

---

## CRITICAL BLOCKERS (must fix -- 6 items)

### C1: Hashline Backward Compatibility
**Problem:** Strict whitespace hashing in hashline changes LINE#ID values for indented lines. Breaks existing anchors in cached/persisted edit operations.
**Fix:** Add a compatibility shim -- when lookup by new hash fails, fall back to legacy hash (without strict whitespace). Or version the hash format.
**Files:** Look for hashline-related files in src/tools/ or src/shared/

### C2: OpenAI-Only Model Catalog Broken with OpenCode-Go
**Problem:** isOpenAiOnlyAvailability() does not exclude availability.opencodeGo. When OpenCode-Go is present, OpenAI-only detection is wrong -- models get misrouted.
**Fix:** Add !availability.opencodeGo check to isOpenAiOnlyAvailability().
**Files:** Model/provider system files -- search for isOpenAiOnlyAvailability

### C3: CLI/Runtime Model Table Divergence
**Problem:** Model tables disagree between CLI install-time and runtime:
- ultrabrain: gpt-5.3-codex in CLI vs gpt-5.4 in runtime
- atlas: claude-sonnet-4-5 in CLI vs claude-sonnet-4-6 in runtime
- unspecified-high also diverges
**Fix:** Reconcile all model tables. Pick the correct model for each and make CLI + runtime match.
**Files:** Search for model table definitions, agent configs, CLI model references

### C4: atlas/metis/sisyphus-junior Missing OpenAI Fallbacks
**Problem:** These agents can resolve to opencode/glm-4.7-free or undefined in OpenAI-only environments. No valid OpenAI fallback paths exist.
**Fix:** Add valid OpenAI model fallback paths for all agents that need them.
**Files:** Agent config/model resolution code

### C5: model_fallback Default Mismatch
**Problem:** Schema and docs say model_fallback defaults to false, but runtime treats unset as true. Silent behavior change for all users.
**Fix:** Align -- either update schema/docs to say true, or fix runtime to default to false. Check what the intended behavior is from git history.
**Files:** Schema definition, runtime config loading

### C6: background_output Default Changed
**Problem:** background_output now defaults to full_session=true. Old callers get different output format without code changes.
**Fix:** Either document this change clearly, or restore old default and make full_session opt-in.
**Files:** Background output handling code

---

## HIGH PRIORITY (strongly recommended -- 4 items)

### H1: Runtime Fallback session-status-handler Race
**Problem:** When fallback model is already pending, the handler cannot advance the chain on subsequent cooldown events.
**Fix:** Allow override like message-update-handler does.
**Files:** Search for session-status-handler, message-update-handler

### H2: Atlas Final-Wave Approval Gate Logic
**Problem:** Approval gate logic does not match real Prometheus plan structure (nested checkboxes, parallel execution). Trigger logic is wrong.
**Fix:** Update to handle real plan structures.
**Files:** Atlas agent code, approval gate logic

### H3: delegate-task-english-directive Dead Code
**Problem:** Not dispatched from tool-execute-before.ts + wrong hook signature. Either wire properly or remove entirely.
**Fix:** Remove if not needed (cleaner). If needed, fix dispatch + signature.
**Files:** src/hooks/, tool-execute-before.ts

### H4: Auto-Slash-Command Session-Lifetime Dedup
**Problem:** Dedup uses session lifetime, suppressing legitimate repeated identical commands.
**Fix:** Change to short TTL (e.g., 30 seconds) instead of session lifetime.
**Files:** Slash command handling code

---

## ADDITIONAL BLOCKERS FROM GPT-5.4 REVIEW

### G1: Package Identity Split-Brain
**Problem:** Installer writes oh-my-openagent but doctor, auto-update, version lookup, publish workflow still reference oh-my-opencode. Half-migrated state.
**Fix:** Audit ALL references to package name. Either complete the migration consistently or revert to single name for this release.
**Files:** Installer, doctor, auto-update, version lookup, publish workflow -- grep for both package names

### G2: OpenCode-Go --opencode-go Value Validation
**Problem:** No validation for --opencode-go CLI value. No detection of existing OpenCode-Go installations.
**Fix:** Add value validation + existing install detection.
**Files:** CLI option handling code

### G3: Skill/Hook Reference Errors
**Problem:**
- work-with-pr references non-existent git tool category
- github-triage references TaskCreate/TaskUpdate which are not real tool names
**Fix:** Fix tool references to use actual tool names.
**Files:** Skill definition files in .opencode/skills/

### G4: Stale Context-Limit Cache
**Problem:** Shared context-limit resolver caches provider config. When config changes, stale removed limits persist and corrupt compaction/truncation decisions.
**Fix:** Add cache invalidation when provider config changes, or make the resolver stateless.
**Files:** Context-limit resolver, compaction code

### G5: disabled_hooks Schema vs Runtime Contract Mismatch
**Problem:** Schema is strict (rejects unknown hook names) but runtime is permissive (ignores unknown). Contract disagreement.
**Fix:** Align -- either make both strict or both permissive.
**Files:** Hook schema definition, runtime hook loading

---

## EXECUTION INSTRUCTIONS

1. Spawn UltraBrain agents to fix these in parallel -- group by file proximity:
   - UB-1: C1 (hashline) + H4 (slash-command dedup)
   - UB-2: C2 + C3 + C4 (model/provider system) + G2
   - UB-3: C5 + C6 (config defaults) + G5
   - UB-4: H1 + H2 (runtime handlers + Atlas gate)
   - UB-5: H3 + G3 (dead code + skill references)
   - UB-6: G1 (package identity -- full audit)
   - UB-7: G4 (context-limit cache)

2. Each UB agent MUST:
   - Write or update tests FIRST (TDD)
   - Implement the fix
   - Run bun test on affected test files
   - Commit with descriptive message

3. After all UB agents complete, run full bun test to verify no regressions.

ulw
