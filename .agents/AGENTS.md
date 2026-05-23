# .agents/ — Project-Scope Skills & Commands (Migration Target)

**Generated:** 2026-05-20

## OVERVIEW

Project-scope skills + slash commands under the new `.agents/` directory name. During the `oh-my-opencode` → `oh-my-openagent` rename transition, this directory is the **target** of the migration from `.opencode/`. It is a strict SUPERSET of `.opencode/` (5 → 9 skills; same 4 commands).

Loaded alongside `.opencode/` by [`src/features/opencode-skill-loader/`](file:///Users/yeongyu/local-workspaces/omo/src/features/opencode-skill-loader/). When both directories declare the same skill or command name, the higher-priority scope wins per the loader's deduplication rules.

## SKILLS (9, superset of `.opencode/`)

| Skill | Also in `.opencode/`? | Purpose |
|-------|------------------------|---------|
| `work-with-pr/` | yes | Full PR lifecycle |
| `work-with-pr-workspace/` | yes | Iteration workspace + benchmark inputs |
| `github-triage/` | yes | Read-only issue/PR triage with evidence reports |
| `hyperplan/` | yes | Adversarial multi-agent planning |
| `pre-publish-review/` | yes | 16-agent pre-publish release gate |
| `get-unpublished-changes/` | NEW | Skill form of the `/get-unpublished-changes` command |
| `omomomo/` | NEW | Skill form of the `/omomomo` easter egg |
| `publish/` | NEW | Skill form of the `/publish` command |
| `remove-deadcode/` | NEW | Skill form of the `/remove-deadcode` command |

The 4 "NEW" skills here are skill-format equivalents of the 4 slash commands that exist in BOTH `.opencode/command/` and `.agents/command/`. They allow the same instructions to be triggered either by an explicit `/command` invocation OR by skill auto-loading on matching prompts.

## COMMANDS (4 slash commands)

Identical set to `.opencode/command/`:
- `/get-unpublished-changes`
- `/omomomo`
- `/publish`
- `/remove-deadcode`

## OTHER CONTENTS

- `background-tasks.json` — Runtime state (parallel to `.opencode/background-tasks.json` during the transition).
- `bun.lock`, `package.json`, `node_modules/` — Skill dependencies.
- `.gitignore` — Local scope ignore.

## MIGRATION STATUS

| Concern | Plan |
|---------|------|
| Why TWO directories? | `.opencode/` is the legacy layout. `.agents/` is the future-proof name after the harness rename. |
| When does `.opencode/` go away? | After the multi-harness refactor lands and existing users have re-installed. Tracked in [ROADMAP](file:///Users/yeongyu/local-workspaces/omo/ROADMAP.md). |
| What if both exist with conflicting skills? | The skill-loader dedupes by name. Higher-priority scope wins. The 5 shared skills (`work-with-pr`, `hyperplan`, etc.) are byte-identical between the two dirs today; if they diverge, fix here first. |
| Where do NEW skills go? | `.agents/` only. Do NOT add new entries to `.opencode/`. |

## CONVENTIONS

- **All NEW skills go in `.agents/`.** `.opencode/` is frozen aside from drift-sync of the 5 shared skills.
- **Drift between shared skills is a bug.** When you update a shared skill, update both copies in the SAME commit until `.opencode/` is removed.
- **Slash commands stay duplicated.** Both directories must contain the same `command/*.md` set for the transition window.

## ANTI-PATTERNS

- Never add a skill to `.opencode/` that does not also exist in `.agents/`.
- Never let the 5 shared skills drift. CI should eventually enforce byte equality; for now, manual diligence.
- Never delete `.opencode/` until the multi-harness refactor lands.
