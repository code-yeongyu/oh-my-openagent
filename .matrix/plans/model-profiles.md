# Model Profiles: budget / balanced / performance

## TL;DR

> **Quick Summary**: Add a `profile` field to `MatrixxConfigSchema` that expands into
> per-agent and per-category model defaults before user/project overrides are applied.
> Three profiles target Vertex AI users: `budget`, `balanced`, `performance`.
>
> **Deliverables**:
> - `src/config/profiles.ts` — new file, profile definitions + `expandProfile()`
> - `src/config/schema/matrixx-config.ts` — add `profile` field to schema
> - `src/plugin-config.ts` — apply profile expansion in `loadPluginConfig()`
> - `src/config/schema.test.ts` — profile schema validation tests
> - `src/config/profiles.test.ts` — new test file, expansion + merge priority tests
> - `assets/matrixx.schema.json` — regenerated via `bun run build:schema`
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 2 waves
> **Critical Path**: Task 1 (schema) → Task 3 (config loading) → Task 4 (schema regen + full test run)

---

## Context

### Original Request
Add predefined model profiles (budget, balanced, performance) to the Matrixx plugin.
When a user sets `"profile": "budget"` in their `matrixx.json`, it expands into
sensible agent + category model defaults, while still allowing individual overrides to win.

### Interview Summary

**Key Discussions**:
- Profiles only set primary `model` (and `variant` where applicable) — AGENT_MODEL_REQUIREMENTS fallback chains are untouched
- Expansion timing: profile is expanded AFTER user+project merge, then used as base layer (`mergeConfigs(profileDefaults, mergedConfig)`)
- Vertex AI context: Claude models use `google-vertex-anthropic/` prefix; Gemini models use standard `google/` prefix
- `keymaker` excluded from profiles — its `requiresProvider` guard handles activation
- `deep-jack` category excluded — has `requiresModel: "gpt-5.3-codex"` guard that conflicts with Vertex-only profiles
- `mouse`, `build`, `plan`, `OpenCode-Builder` excluded — not relevant for profile configuration

**Research Findings**:
- Model strings confirmed from codebase: `google-vertex-anthropic/claude-opus-4-6@default` (variant `max`), `google-vertex-anthropic/claude-sonnet-4-6@default`, `google/gemini-3.1-pro` (variant `high`), `google/gemini-3-flash`, `google/gemini-2.5-flash`
- `mergeConfigs()` deep-merges `agents` and `categories` — profile as base layer is safe
- `mergeCategories()` does `{ ...DEFAULT_CATEGORIES, ...userCategories }` — profile categories go in via `config.categories` and only need `{ model, variant }` to avoid overwriting `DEFAULT_CATEGORIES` metadata

### Seraph Review
**Identified Gaps** (all addressed):
- Unconfirmed Vertex Gemini model strings → resolved by codebase grep (google/ prefix confirmed)
- `mergeCategories()` shallow-spread risk → mitigated: profile categories only set `{ model, variant }`
- `deep-jack` requiresModel conflict → excluded from profile categories
- `seraph` in performance profile → clarified: gets Opus (highest quality, consistent with "performance")
- `keymaker` exclusion rationale → documented: requiresProvider gates the whole agent

---

## Work Objectives

### Core Objective
Add a `profile` field to `MatrixxConfig` that expands into model defaults for all
Matrixx agents and categories, positioned as the lowest-priority layer in the
config hierarchy so user and project overrides always win.

### Concrete Deliverables
- `src/config/profiles.ts` — pure, synchronous `expandProfile()` with typed profile data
- Schema addition — `profile?: z.enum(["budget", "balanced", "performance"])`
- `loadPluginConfig()` — profile expansion applied as base layer after user+project merge
- Tests — RED-GREEN-REFACTOR for schema validation + expansion + merge priority

### Definition of Done
- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/config/profiles.test.ts` — all new tests pass
- [ ] `bun test src/config/schema.test.ts` — all schema tests pass (including new profile tests)
- [ ] `bun test` — no regressions in existing test suite
- [ ] `grep '"profile"' assets/matrixx.schema.json` exits 0 (schema regenerated)

### Must Have
- Profile is the base layer — user and project agent/category overrides win over profile
- Profile categories set ONLY `{ model, variant }` — never full CategoryConfig
- `expandProfile()` is pure and synchronous — no async calls, no provider checks
- `keymaker` absent from all profile definitions
- `deep-jack` absent from all profile category definitions
- TDD: failing test written before any implementation code

### Must NOT Have (Guardrails)
- **NO** modification of `src/shared/model-requirements.ts` or any fallback chain
- **NO** `profile` field on `AgentOverrideConfigSchema` (top-level only)
- **NO** async behavior or provider availability checks in `expandProfile()`
- **NO** full `CategoryConfig` objects in profile definitions (only `{ model, variant? }`)
- **NO** `keymaker`, `mouse`, `build`, `plan`, `OpenCode-Builder` in profile agent maps
- **NO** `deep-jack` in profile category maps
- **NO** `google-vertex/gemini-*` strings — Gemini models use `google/` prefix
- **NO** exceeding 200 LOC in `profiles.ts` (split to `profiles/` dir if needed)
- **NO** modifying README or other documentation files

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test, 176 test files, BDD comments)
- **Automated tests**: YES — TDD (RED-GREEN-REFACTOR)
- **Framework**: bun test

### TDD Structure

Each TODO follows RED-GREEN-REFACTOR. Test files:
- `src/config/schema.test.ts` — append profile schema tests
- `src/config/profiles.test.ts` — new file for expansion + merge priority

**Test commands**:
```bash
cd /home/klpanagi/matrixx && bun test src/config/schema.test.ts
cd /home/klpanagi/matrixx && bun test src/config/profiles.test.ts
cd /home/klpanagi/matrixx && bun test
```

### Agent-Executed QA Scenarios

```
Scenario: Schema accepts valid profile values
  Tool: Bash
  Steps:
    1. cd /home/klpanagi/matrixx && bun test src/config/schema.test.ts
    2. Assert: exit code 0
    3. Assert: stdout contains "profile" test descriptions
  Evidence: Test output

Scenario: Schema rejects invalid profile value
  Tool: Bash
  Steps:
    1. bun test src/config/schema.test.ts
    2. Assert: test "should reject unknown profile" passes
  Evidence: Test output

Scenario: expandProfile returns correct model for each profile
  Tool: Bash
  Steps:
    1. bun test src/config/profiles.test.ts
    2. Assert: "budget profile sets morpheus to sonnet" passes
    3. Assert: "performance profile sets morpheus to opus" passes
    4. Assert: "balanced profile sets morpheus to opus" passes
  Evidence: Test output

Scenario: User override wins over profile
  Tool: Bash
  Steps:
    1. bun test src/config/profiles.test.ts
    2. Assert: "user agent override beats profile default" passes
    3. Assert: "project config overrides user profile" passes
  Evidence: Test output

Scenario: keymaker excluded from all profiles
  Tool: Bash
  Steps:
    1. bun test src/config/profiles.test.ts
    2. Assert: "expandProfile never includes keymaker" passes for all 3 profiles
  Evidence: Test output

Scenario: Schema JSON regenerated with profile field
  Tool: Bash
  Steps:
    1. cd /home/klpanagi/matrixx && bun run build:schema
    2. Assert: exit code 0
    3. grep '"profile"' assets/matrixx.schema.json
    4. Assert: exit code 0 (found)
    5. grep '"budget"' assets/matrixx.schema.json
    6. Assert: exit code 0 (found)
  Evidence: grep output

Scenario: No regressions in full test suite
  Tool: Bash
  Steps:
    1. cd /home/klpanagi/matrixx && bun test
    2. Assert: exit code 0
    3. Assert: stdout does not contain "FAIL" for any pre-existing test file
  Evidence: Test output summary
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Simultaneously):
├── Task 1: Schema + profiles.ts (schema change + new file)
└── Task 2: Test files (write failing tests first)

Wave 2 (After Wave 1 completes):
├── Task 3: loadPluginConfig() integration
└── (Task 1 GREEN phase — implement after tests are RED)

Wave 3 (Final):
└── Task 4: Schema regen + full test run + typecheck
```

**Note on TDD sequencing**: Task 2 (write failing tests) should start in Wave 1.
Task 1 implementation (make tests go GREEN) is Wave 2. This is intentional RED-GREEN ordering.

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 (Schema + profiles.ts) | None | 3, 4 | 2 |
| 2 (Failing tests) | None | 3 | 1 |
| 3 (loadPluginConfig integration) | 1, 2 | 4 | None |
| 4 (build:schema + full test run) | 1, 2, 3 | None | None |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agent |
|------|-------|------------------|
| 1 | 1 + 2 | Dispatch in parallel (2 agents) |
| 2/3 | 3 | Single agent after Wave 1 |
| Final | 4 | Single agent (verification) |

---

## TODOs

- [ ] 1. Create `src/config/profiles.ts` + add `profile` field to `MatrixxConfigSchema`

  **What to do**:

  **Part A — `src/config/schema/matrixx-config.ts`**:
  - Add `profile: z.enum(["budget", "balanced", "performance"]).optional()` to `MatrixxConfigSchema`
  - Place it after `$schema` and before `new_task_system_enabled` (top of the object, user-facing fields first)
  - Add JSDoc: `/** Predefined model profile. Expands into agent + category model defaults. User/project overrides take priority. */`

  **Part B — `src/config/profiles.ts` (NEW FILE)**:
  - Export type: `export type ProfileName = "budget" | "balanced" | "performance"`
  - Export function: `export function expandProfile(profile: ProfileName): { agents?: AgentOverrides; categories?: CategoriesConfig }`
  - Define three profile objects (see model assignments below)

  **Profile model assignments** (exact model strings from codebase):

  ```
  PERFORMANCE (max quality):
    Agents:
      morpheus:   model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      oracle:     model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      seraph:     model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      cipher:     model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      niobe:      model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      sentinel:   model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      merovingian: model: "google/gemini-3.1-pro", variant: "high"
      smith:      model: "google/gemini-3.1-pro", variant: "high"
      architect:  model: "google/gemini-3-flash"
      construct:  model: "google/gemini-3-flash"
      trinity:    model: "google/gemini-2.5-flash"
      operator:   model: "google/gemini-2.5-flash"
    Categories:
      source:         model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      dsl-engineering: model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      red-pill:       model: "google/gemini-3.1-pro", variant: "high"
      matrix-bend:    model: "google/gemini-3.1-pro", variant: "high"
      blue-pill:      model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      broadcast:      model: "google/gemini-3-flash"
      bullet-time:    model: "google/gemini-2.5-flash"
      construct:      model: "google/gemini-3.1-pro", variant: "high"

  BALANCED (quality + cost):
    Agents:
      morpheus:   model: "google-vertex-anthropic/claude-opus-4-6@default", variant: "max"
      oracle:     model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      seraph:     model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      cipher:     model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      niobe:      model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      sentinel:   model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      merovingian: model: "google/gemini-3.1-pro", variant: "high"
      smith:      model: "google/gemini-3.1-pro", variant: "high"
      architect:  model: "google/gemini-3-flash"
      construct:  model: "google/gemini-3-flash"
      trinity:    model: "google/gemini-2.5-flash"
      operator:   model: "google/gemini-2.5-flash"
    Categories:
      source:         model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      dsl-engineering: model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      red-pill:       model: "google/gemini-3.1-pro", variant: "high"
      matrix-bend:    model: "google/gemini-3.1-pro", variant: "high"
      blue-pill:      model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      broadcast:      model: "google/gemini-3-flash"
      bullet-time:    model: "google/gemini-2.5-flash"
      construct:      model: "google/gemini-3.1-pro", variant: "high"

  BUDGET (minimize cost):
    Agents:
      morpheus:   model: "google-vertex-anthropic/claude-sonnet-4-6@default"
      oracle:     model: "google/gemini-3.1-pro", variant: "high"
      seraph:     model: "google/gemini-3.1-pro", variant: "high"
      cipher:     model: "google/gemini-3.1-pro", variant: "high"
      niobe:      model: "google/gemini-3.1-pro", variant: "high"
      sentinel:   model: "google/gemini-3.1-pro", variant: "high"
      merovingian: model: "google/gemini-3.1-pro", variant: "high"
      smith:      model: "google/gemini-3.1-pro", variant: "high"
      architect:  model: "google/gemini-2.5-flash"
      construct:  model: "google/gemini-2.5-flash"
      trinity:    model: "google/gemini-2.5-flash"
      operator:   model: "google/gemini-2.5-flash"
    Categories:
      source:         model: "google/gemini-3.1-pro", variant: "high"
      dsl-engineering: model: "google/gemini-3.1-pro", variant: "high"
      red-pill:       model: "google/gemini-3.1-pro", variant: "high"
      matrix-bend:    model: "google/gemini-3.1-pro", variant: "high"
      blue-pill:      model: "google/gemini-3.1-pro"
      broadcast:      model: "google/gemini-2.5-flash"
      bullet-time:    model: "google/gemini-2.5-flash"
      construct:      model: "google/gemini-3.1-pro", variant: "high"
  ```

  **Must NOT do**:
  - Do NOT add `keymaker` to any profile agent map
  - Do NOT add `deep-jack` to any profile category map
  - Do NOT include `mouse`, `build`, `plan`, `OpenCode-Builder` in profiles
  - Do NOT add full CategoryConfig objects (only `{ model, variant? }`)
  - Do NOT make `expandProfile()` async
  - Do NOT modify `model-requirements.ts`
  - Do NOT exceed 200 LOC in `profiles.ts` (split to `profiles/` dir if needed)

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Bounded, well-defined data authoring + schema change. Two specific files with exact content specified. No architectural decisions needed.
  - **Skills**: none required
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed, no git operations during implementation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None (can start immediately)

  **References**:

  Pattern References:
  - `src/config/schema/matrixx-config.ts:24-58` — Exact location to add `profile` field, surrounding context for placement
  - `src/config/schema/categories.ts:1-43` — `CategoryConfig` type shape (only set `model` and `variant` from this)
  - `src/config/schema/agent-overrides.ts:51-69` — `AgentOverrides` type — these are the exact keys available for the `agents` map in `expandProfile()`
  - `src/config/schema.ts` — barrel export pattern to follow for any new exports

  API/Type References:
  - `src/config/schema/agent-overrides.ts:71-72` — `AgentOverrides` and `AgentOverrideConfig` types
  - `src/config/schema/categories.ts:40-42` — `CategoryConfig` and `CategoriesConfig` types
  - `src/config/schema/matrixx-config.ts:60` — `MatrixxConfig` type (profiles.ts return type references these)

  WHY Each Reference Matters:
  - `AgentOverrides` shape: `expandProfile()` must return an object matching this type exactly — the key names (`morpheus`, `oracle`, etc.) must match the schema keys
  - `CategoryConfig` shape: Profile category entries must only include fields present in this type, and only `model`+`variant` to avoid wiping DEFAULT_CATEGORIES metadata

  **Acceptance Criteria**:

  - [ ] `src/config/schema/matrixx-config.ts` has `profile: z.enum(["budget", "balanced", "performance"]).optional()`
  - [ ] `src/config/profiles.ts` exists and exports `expandProfile` and `ProfileName`
  - [ ] `expandProfile("budget")` does not include `keymaker` in `.agents`
  - [ ] `expandProfile("budget")` does not include `deep-jack` in `.categories`
  - [ ] All profile category entries have ONLY `model` (and optionally `variant`) — no `description`, `is_unstable_agent`, etc.
  - [ ] `bun run typecheck` exits 0 after this task (verify types are correct)

  ```
  Scenario: TypeScript compiles after schema + profiles.ts creation
    Tool: Bash
    Steps:
      1. cd /home/klpanagi/matrixx && bun run typecheck
      2. Assert: exit code 0
      3. Assert: stdout contains 0 errors
    Evidence: typecheck output
  ```

  **Commit**: YES (groups with Task 2 after GREEN)
  - Message: `feat(config): add profile field to schema and expandProfile() function`
  - Files: `src/config/schema/matrixx-config.ts`, `src/config/profiles.ts`
  - Pre-commit: `bun run typecheck`

---

- [ ] 2. Write failing tests for profile schema validation and expansion logic

  **What to do**:

  **Part A — Append to `src/config/schema.test.ts`**:

  Add a `describe("profile schema")` block with these tests:
  ```typescript
  describe("profile schema", () => {
    test("should accept 'budget' profile", () => {
      //#given
      const config = { profile: "budget" }
      //#when
      const result = MatrixxConfigSchema.safeParse(config)
      //#then
      expect(result.success).toBe(true)
    })
    test("should accept 'balanced' profile", () => { /* same pattern */ })
    test("should accept 'performance' profile", () => { /* same pattern */ })
    test("should accept profile combined with agent overrides", () => {
      const config = { profile: "budget", agents: { morpheus: { model: "custom/model" } } }
      const result = MatrixxConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })
    test("should reject unknown profile value", () => {
      const config = { profile: "ultra" }
      const result = MatrixxConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })
    test("should accept config without profile (backward compat)", () => {
      const config = { agents: { morpheus: { model: "anthropic/claude-opus-4-6" } } }
      const result = MatrixxConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      expect(result.data?.profile).toBeUndefined()
    })
  })
  ```

  **Part B — Create `src/config/profiles.test.ts` (NEW FILE)**:

  Write tests in BDD style (`//#given`, `//#when`, `//#then`) covering:

  1. **Expansion correctness per profile**:
     - `expandProfile("budget").agents?.morpheus?.model` === `"google-vertex-anthropic/claude-sonnet-4-6@default"`
     - `expandProfile("balanced").agents?.morpheus?.model` === `"google-vertex-anthropic/claude-opus-4-6@default"`
     - `expandProfile("performance").agents?.morpheus?.model` === `"google-vertex-anthropic/claude-opus-4-6@default"`
     - `expandProfile("performance").agents?.morpheus?.variant` === `"max"`

  2. **Keymaker always excluded**:
     - For each of the 3 profiles: `expandProfile(p).agents?.keymaker` === `undefined`

  3. **deep-jack always excluded from categories**:
     - For each of the 3 profiles: `expandProfile(p).categories?.["deep-jack"]` === `undefined`

  4. **Category entries only have model/variant**:
     - For each profile, for each category key returned, assert the entry has no keys other than `model` and optionally `variant`
     - `Object.keys(entry).every(k => k === "model" || k === "variant")`

  5. **Merge priority — profile loses to user override** (integration with `mergeConfigs`):
     - Import `mergeConfigs` from `../../plugin-config`
     - Given: profile defaults from `expandProfile("budget")`, user config with `agents: { morpheus: { model: "custom/override" } }`
     - Apply: `mergeConfigs(expandProfile("budget") as MatrixxConfig, userConfig as MatrixxConfig)`
     - Assert: `result.agents?.morpheus?.model` === `"custom/override"` (user wins)

  6. **Project profile wins over user profile**:
     - Given user config `{ profile: "balanced" }`, project config `{ profile: "budget" }`
     - After `mergeConfigs(userConfig, projectConfig)`: `result.profile` === `"budget"`

  7. **No profile → no expansion (guard test)**:
     - `expandProfile` is only called when profile is defined — this is tested implicitly by the `loadPluginConfig` integration test in schema.test.ts

  **Must NOT do**:
  - Do NOT import from files that don't exist yet (this is RED phase — tests will fail to compile or fail at runtime)
  - Write the test imports assuming the final file structure will exist
  - Do NOT test internal implementation details of how profiles are stored

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Pure test authoring with exact content specified. No decisions needed.
  - **Skills**: none

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:

  Pattern References:
  - `src/config/schema.test.ts:1-60` — Exact test structure, import pattern, describe/test/expect style to follow
  - `src/plugin-config.ts:93-134` — `mergeConfigs()` signature for the merge priority tests
  - `src/plugin-config.test.ts` — Existing config loading tests to understand test patterns

  API/Type References:
  - `src/config/profiles.ts` — (will be created in Task 1) — import `expandProfile`, `ProfileName`
  - `src/plugin-config.ts` — import `mergeConfigs` for merge priority tests
  - `src/config/schema/matrixx-config.ts` — import `MatrixxConfig` type for cast in merge tests

  **Acceptance Criteria**:

  - [ ] `src/config/schema.test.ts` has profile describe block with 6 tests
  - [ ] `src/config/profiles.test.ts` exists with all 7 test groups
  - [ ] `bun test src/config/schema.test.ts` — FAILS on new profile tests (RED — `profile` field not in schema yet)
  - [ ] `bun test src/config/profiles.test.ts` — FAILS (RED — `profiles.ts` not created yet)
  - [ ] Existing tests in `schema.test.ts` still pass (no regressions in non-profile tests)

  ```
  Scenario: Tests are correctly RED before implementation
    Tool: Bash
    Steps:
      1. cd /home/klpanagi/matrixx && bun test src/config/profiles.test.ts 2>&1
      2. Assert: stdout contains "error" or test failures (expected — RED phase)
    Evidence: Test failure output confirming RED state
  ```

  **Commit**: NO — commit after GREEN (with Task 1)

---

- [ ] 3. Integrate profile expansion into `loadPluginConfig()` + make tests GREEN

  **What to do**:

  **Part A — Modify `src/plugin-config.ts`**:

  After the existing user+project merge (line ~171), add profile expansion:

  ```typescript
  // After: config = projectConfig ? mergeConfigs(config, projectConfig) : config
  // Add:
  if (config.profile) {
    const { expandProfile } = await import("./config/profiles")  // or static import at top
    const profileDefaults = expandProfile(config.profile)
    config = mergeConfigs(profileDefaults as MatrixxConfig, config)
  }
  ```

  **IMPORTANT**: The import should be a static import at the top of the file (not dynamic), consistent with the existing import style. Add to existing imports:
  ```typescript
  import { expandProfile } from "./config/profiles"
  ```

  **IMPORTANT**: The merge order is `mergeConfigs(profileDefaults, config)` — profile is the BASE (first arg), user+project merged config is the OVERRIDE (second arg). This ensures user/project settings always win.

  The insertion point in `loadPluginConfig()` is BEFORE the final `config = { ...config }` spread on line 174.

  **Part B — Make failing tests GREEN**:

  At this point, both Task 1 (profiles.ts + schema change) and Task 2 (failing tests) should be complete. Run:
  ```bash
  bun test src/config/schema.test.ts
  bun test src/config/profiles.test.ts
  ```

  If any tests still fail, fix the implementation (not the tests). Diagnose failures carefully:
  - Schema tests failing → `profile` field not added to `MatrixxConfigSchema`
  - Expansion tests failing → `expandProfile()` returns wrong model string or includes excluded agents
  - Merge priority tests failing → merge order is wrong in `loadPluginConfig()` or `mergeConfigs()` semantics misunderstood

  **Must NOT do**:
  - Do NOT change the merge order to make tests pass — the order MUST be `mergeConfigs(profileDefaults, config)`
  - Do NOT add `profile` handling to `mergeConfigs()` itself — it should remain ignorant of profiles
  - Do NOT modify `mergeConfigs()` — only `loadPluginConfig()`

  **Recommended Agent Profile**:
  - **Category**: `blue-pill`
    - Reason: Surgical integration — one insertion point in `plugin-config.ts`, plus diagnosis of any test failures. Low complexity, clear target.
  - **Skills**: none

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: Tasks 1 and 2

  **References**:

  Pattern References:
  - `src/plugin-config.ts:156-186` — `loadPluginConfig()` — exact insertion point (after line 171, before line 174)
  - `src/plugin-config.ts:93-134` — `mergeConfigs()` — understand the semantics before using it

  API/Type References:
  - `src/config/profiles.ts` — `expandProfile()` and `ProfileName` (created in Task 1)
  - `src/config/schema/matrixx-config.ts` — `MatrixxConfig` type (for cast if needed)

  WHY Each Reference Matters:
  - Line 171 is the exact insertion point: after `config = mergeConfigs(config, projectConfig)` — profile must come after this so that user+project are fully merged before profile is applied as base
  - `mergeConfigs(base, override)` semantics: second arg wins — so profile (first) loses to user+project config (second) ✅

  **Acceptance Criteria**:

  - [ ] `src/plugin-config.ts` imports `expandProfile` from `"./config/profiles"`
  - [ ] Profile expansion is inserted after user+project merge, before final spread
  - [ ] Merge order is `mergeConfigs(profileDefaults as MatrixxConfig, config)` (profile = base)
  - [ ] `bun test src/config/schema.test.ts` — all tests pass (GREEN)
  - [ ] `bun test src/config/profiles.test.ts` — all tests pass (GREEN)
  - [ ] `bun run typecheck` — exits 0

  ```
  Scenario: All profile tests pass (GREEN)
    Tool: Bash
    Steps:
      1. cd /home/klpanagi/matrixx && bun test src/config/profiles.test.ts
      2. Assert: exit code 0
      3. Assert: stdout contains "X pass" with no failures
      4. cd /home/klpanagi/matrixx && bun test src/config/schema.test.ts
      5. Assert: exit code 0
    Evidence: Test output

  Scenario: User override beats profile
    Tool: Bash (via test)
    Steps:
      1. bun test src/config/profiles.test.ts -- --testNamePattern "user agent override"
      2. Assert: exit code 0
    Evidence: Test output
  ```

  **Commit**: YES
  - Message: `feat(config): integrate profile expansion into loadPluginConfig`
  - Files: `src/plugin-config.ts`
  - Pre-commit: `bun test src/config/profiles.test.ts && bun test src/config/schema.test.ts`

---

- [ ] 4. Regenerate JSON schema + run full test suite + verify no regressions

  **What to do**:

  1. Run `bun run build:schema` to regenerate `assets/matrixx.schema.json`
  2. Verify the schema contains the `profile` enum
  3. Run the full test suite: `bun test`
  4. Run typecheck: `bun run typecheck`
  5. If any pre-existing tests fail, investigate carefully — this task owns fixing regressions

  **Note on `bun run build:schema`**: This regenerates `assets/matrixx.schema.json` from the Zod schema. It should succeed if Task 1 (schema change) was done correctly.

  **Note on full test suite**: Some tests are known-flaky (matrix-loop CI timeout, session-state parallel pollution per AGENTS.md). If only these specific known-flaky tests fail and they are unrelated to profiles, that is acceptable and should be documented.

  **Must NOT do**:
  - Do NOT skip `bun run build:schema` — it's mandatory after schema changes
  - Do NOT fix failing pre-existing tests by deleting them (per AGENTS.md anti-patterns)
  - Do NOT commit if `bun run typecheck` has errors

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Pure verification — run commands, check outputs, fix any simple regressions.
  - **Skills**: none

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Final wave (sequential after Tasks 1, 2, 3)
  - **Blocks**: Nothing (final task)
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  Pattern References:
  - `AGENTS.md` — Known flaky tests section (do not treat known-flaky failures as regressions)
  - `src/config/schema.test.ts` — verify new tests appear in output

  **Acceptance Criteria**:

  - [ ] `bun run build:schema` exits 0
  - [ ] `grep '"profile"' assets/matrixx.schema.json` exits 0
  - [ ] `grep '"budget"' assets/matrixx.schema.json` exits 0
  - [ ] `grep '"balanced"' assets/matrixx.schema.json` exits 0
  - [ ] `grep '"performance"' assets/matrixx.schema.json` exits 0
  - [ ] `bun test` exits 0 (or only known-flaky tests fail)
  - [ ] `bun run typecheck` exits 0

  ```
  Scenario: Schema JSON contains profile field
    Tool: Bash
    Preconditions: bun run build:schema has been run
    Steps:
      1. grep '"profile"' /home/klpanagi/matrixx/assets/matrixx.schema.json
      2. Assert: exit code 0
      3. grep '"budget"' /home/klpanagi/matrixx/assets/matrixx.schema.json
      4. Assert: exit code 0
    Evidence: grep output

  Scenario: Full test suite passes
    Tool: Bash
    Steps:
      1. cd /home/klpanagi/matrixx && bun test 2>&1 | tail -20
      2. Assert: exit code 0
      3. Assert: output shows passing count > 0
      4. Assert: no unexpected failures (only known-flaky tests if any)
    Evidence: bun test summary output

  Scenario: TypeScript compiles cleanly
    Tool: Bash
    Steps:
      1. cd /home/klpanagi/matrixx && bun run typecheck
      2. Assert: exit code 0
    Evidence: typecheck output
  ```

  **Commit**: YES
  - Message: `chore(schema): regenerate matrixx.schema.json with profile field`
  - Files: `assets/matrixx.schema.json`
  - Pre-commit: `bun run build:schema`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 + 2 (GREEN) | `feat(config): add profile field to schema and expandProfile() function` | `src/config/schema/matrixx-config.ts`, `src/config/profiles.ts`, `src/config/schema.test.ts`, `src/config/profiles.test.ts` | `bun test src/config/profiles.test.ts && bun test src/config/schema.test.ts` |
| 3 | `feat(config): integrate profile expansion into loadPluginConfig` | `src/plugin-config.ts` | `bun test src/config/profiles.test.ts && bun test src/config/schema.test.ts` |
| 4 | `chore(schema): regenerate matrixx.schema.json with profile field` | `assets/matrixx.schema.json` | `bun run build:schema` |

---

## Success Criteria

### Verification Commands
```bash
# Schema has profile field
grep '"profile"' /home/klpanagi/matrixx/assets/matrixx.schema.json  # Expected: match found

# All new tests pass
cd /home/klpanagi/matrixx && bun test src/config/profiles.test.ts  # Expected: X pass, 0 fail

# Full test suite
cd /home/klpanagi/matrixx && bun test  # Expected: 0 failures (excluding known-flaky)

# Type safety
cd /home/klpanagi/matrixx && bun run typecheck  # Expected: exit 0, 0 errors
```

### Final Checklist
- [ ] All "Must Have" present: profile is base layer, categories are `{ model, variant? }` only, expansion is pure/sync
- [ ] All "Must NOT Have" absent: no keymaker/deep-jack in profiles, no model-requirements.ts modifications, no async expansion
- [ ] All tests pass (schema + profiles + full suite)
- [ ] JSON schema regenerated with profile enum
- [ ] TypeScript clean
