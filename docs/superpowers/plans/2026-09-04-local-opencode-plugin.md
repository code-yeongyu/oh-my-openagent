# Local OpenCode Plugin Wiring Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the repository's required QA and evidence workflow.

**Goal:** Configure the installed OpenCode 1.18.27 instance to load the cloned oh-my-openagent source entrypoint directly, so future `git pull` operations update the plugin without republishing or relinking a package.

**Architecture:** Preserve the existing OpenCode JSONC configuration and its `model-watch` plugin/MCP entries. Remove any pre-existing package-style `oh-my-opencode` or `oh-my-openagent` plugin entry, then add one absolute `file://` plugin entry targeting `packages/omo-opencode/src/index.ts`; install the checkout's workspace dependencies so OpenCode can resolve the source tree at runtime. Verify the effective configuration with the plugin's doctor command and a real isolated OpenCode smoke test using a faithful copy of the edited config.

**Tech Stack:** OpenCode 1.18.27, JSONC configuration, the repository's Bun workspace, and the `.agents/skills/opencode-qa` isolated harness.

---

### Task 1: Document the approved local-source design

**Files:**
- Create: `docs/superpowers/specs/2026-09-04-local-opencode-plugin-design.md`

- [x] **Step 1: Record the design and constraints**

Document the absolute source entrypoint, the preserved existing configuration, removal of conflicting OMO package entries, the dependency-install prerequisite, the fact that `git pull` refreshes source code, and the residual requirement to reinstall dependencies when the lockfile changes.

- [x] **Step 2: Self-review the design document**

Check for placeholders, contradictions, ambiguous paths, and accidental secret-bearing configuration content.

- [x] **Step 3: Commit the design document**

Run:

```bash
git add docs/superpowers/specs/2026-09-04-local-opencode-plugin-design.md
git commit -m "docs: define local OpenCode plugin wiring"
```

Expected: one commit containing only the design document.

### Task 2: Install checkout dependencies without changing source

**Files:**
- Modify: ignored dependency/install outputs only (`node_modules/` and package-manager metadata as required by the repository tooling)

- [ ] **Step 1: Confirm the checkout is clean and the source entrypoint exists**

Run:

```bash
git status --short --branch
test -f packages/omo-opencode/src/index.ts
```

Expected: the task branch is clean and the source entrypoint exists.

- [ ] **Step 2: Install the repository's Bun workspace dependencies**

Use the supported Bun package-manager path available in the environment (the environment may need a temporary `npm exec --package=bun@1.3.12 -- bun ...` launcher because `bun` is not necessarily installed on `PATH`). Do not run a global install and do not change tracked source/config files.

- [ ] **Step 3: Verify dependency installation**

Run the repository's focused OpenCode adapter typecheck or equivalent dependency-resolution check. Expected: exit code 0, or record the exact environment limitation if the checkout cannot be built in this environment.

### Task 3: Wire the live OpenCode configuration to the checkout

**Files:**
- Modify: `~/.config/opencode/opencode.jsonc` (outside the repository; preserve existing entries)

- [ ] **Step 1: Snapshot the active config without printing secrets**

Record a redacted copy/digest and the existing plugin/MCP keys in the evidence directory. Do not include authentication values or environment dumps.

- [ ] **Step 2: Add the source plugin entry**

Remove any existing `oh-my-opencode`, `oh-my-openagent`, `npm:oh-my-opencode`, `npm:oh-my-openagent`, and versioned/package-qualified variants from the plugin array, then ensure it contains exactly this OMO source entry while retaining `file:///home/heki/.config/opencode/model-watch.js` and the existing `ouroboros` MCP:

```json
"file:///home/heki/workspace/oh-my-openagent/packages/omo-opencode/src/index.ts"
```

- [ ] **Step 3: Verify JSONC and idempotency**

Parse the active config, assert the source entry is present once, assert no OMO package-style entry remains, assert the existing plugin/MCP remain, and run the wiring operation a second time to confirm no duplicate entry.

### Task 4: Prove the live plugin wiring

**Files:**
- Create: `.omo/evidence/20260904-local-opencode-plugin/what-was-tested.md`
- Create: `.omo/evidence/20260904-local-opencode-plugin/config-before-after.txt`
- Create: `.omo/evidence/20260904-local-opencode-plugin/doctor.txt`
- Create: `.omo/evidence/20260904-local-opencode-plugin/opencode-qa.txt`

- [ ] **Step 1: Run the plugin doctor against the live installation**

Run the doctor in JSON or text mode and capture sanitized output proving the source entry resolves and OpenCode 1.18.27 is supported. Record that the doctor applies a minimum-version floor, so its pinned SDK version need not exactly equal the installed CLI version.

- [ ] **Step 2: Run the mandatory isolated OpenCode QA**

Run the relevant `.agents/skills/opencode-qa` self-check plus a source-plugin smoke case with isolated XDG directories. Seed the isolated config from a faithful, sanitized copy of the edited live config so it includes `model-watch`, `ouroboros`, and the OMO source entry. Record before/after real session counts and the exact observed event/output. Never use the real OpenCode database for spawned QA.

- [ ] **Step 3: Write reviewer-readable evidence**

Explain what was tested, what was observed, why it covers source loading/config preservation, and what was omitted or remains environment-dependent. Redact credentials, auth headers, and private environment values.

- [ ] **Step 4: Run final repository checks**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; only the documented design/evidence changes are present in the task branch.
