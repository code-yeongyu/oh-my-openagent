---
name: get-unpublished-changes
description: "Compare HEAD with the latest published npm versions and list all unpublished changes by release layer. Triggers: unpublished changes, changelog, what changed, whats new."
---

IMMEDIATELY output the analysis. NO questions. NO preamble.

## CRITICAL: DO NOT just copy commit messages!

For each commit, you MUST:
1. Read the actual diff to understand WHAT CHANGED
2. Describe the REAL change in plain language
3. Explain WHY it matters (if not obvious)

## Release Layers

Analyze every change against these exact layers:

| Layer | Includes | Version question |
|---|---|---|
| `omo pure components` | `packages/*-core`, MCP packages, `packages/shared-skills`, reusable scripts | Do shared components need a patch/minor/major release note even if adapters only consume them internally? |
| `omo opencode` | Root `oh-my-opencode` / `oh-my-openagent`, `src/`, `.opencode/`, `.agents/`, CLI, config, hooks, tools, docs | What semver bump should the OpenCode/OpenAgent npm packages use? |
| `omo codex` | `packages/omo-codex`, `lazycodex-ai`, Codex plugin metadata/hooks, bundled MCP runtimes, `code-yeongyu/lazycodex` marketplace payload | Does LazyCodex need the same bump, a Codex-only note, or a marketplace release? |

## Steps:
1. Detect latest published versions for `oh-my-opencode`, `oh-my-openagent`, and `lazycodex-ai`.
2. Run `git diff v{published-version}..HEAD` to see actual changes.
3. Classify every file into one or more release layers before grouping by feat/fix/refactor/docs.
4. Describe the REAL changes and why each layer cares.
5. Note breaking changes by affected layer.
6. Recommend a layer-specific version bump and one overall workflow bump.

## Output Format:
- feat: "Added X that does Y" (not just "add X feature")
- fix: "Fixed bug where X happened, now Y" (not just "fix X bug")
- refactor: "Changed X from A to B, now supports C" (not just "rename X")

Include:
- `Layered Impact Matrix`: rows for `omo pure components`, `omo opencode`, `omo codex`
- `Layer-specific Version Recommendation`: patch/minor/major per layer plus one overall release bump
