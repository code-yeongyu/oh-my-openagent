# .agents/ — Project-Scope Skills & Commands (Migration Target)

**Generated:** 2026-09-10 / bee8c2ba4
**Scope score:** 9 — distinct migration boundary, retained.

## OVERVIEW

Project-scope skills + slash commands under the new `.agents/` directory name. During the `oh-my-opencode` → `oh-my-openagent` rename transition, this directory is the **target** of the migration from `.opencode/`. Its catalog is a strict SUPERSET: 13 loadable skills (legacy: 4), one shared evaluation workspace, and 5 commands.

Skills load alongside `.opencode/` through [`packages/skills-loader-core/src/features/opencode-skill-loader/`](../packages/skills-loader-core/src/features/opencode-skill-loader/); the old `packages/omo-opencode/src/features/opencode-skill-loader/` path re-exports that implementation. Skill-name collisions follow the loader's scope-priority deduplication rules.

## SKILLS (13 loadable + 1 evaluation workspace)

| Skill | Also in `.opencode/`? | Purpose |
|-------|------------------------|---------|
| `work-with-pr/` | yes | Full PR lifecycle |
| `work-with-pr-workspace/` | yes | Iteration workspace + benchmark inputs; no `SKILL.md`, not loadable |
| `github-triage/` | yes | Read-only issue/PR triage with evidence reports |
| `hyperplan/` | yes | Adversarial multi-agent planning |
| `pre-publish-review/` | yes | 12-agent pre-publish release gate |
| `get-unpublished-changes/` | NEW | Skill form of the `/get-unpublished-changes` command |
| `omomomo/` | NEW | Skill form of the `/omomomo` easter egg |
| `publish/` | NEW | Skill form of the `/publish` command |
| `remove-deadcode/` | NEW | Skill form of the `/remove-deadcode` command |
| `security-research/` | NEW | Team Mode security research audit: 3 vulnerability hunters + 2 PoC engineers |
| `codex-qa/` | no | Isolated Codex Light QA: app-server hook assertions against a local mock model; LSP scenarios, installer and TUI probes |
| `opencode-qa/` | no | CLI/TUI/SSE QA and session DB inspection; LSP scenarios and server split/wake probes |
| `senpi-qa/` | no | Live Senpi adapter + task-engine QA against the real `senpi` binary in an isolated `SENPI_CODING_AGENT_DIR`; `scripts/resolve-evidence-dir.mjs` pins every artifact to `.omo/evidence/omo-senpi-adapter/<slug>/` |
| `tech-debt-audit/` | no | Technical-debt audit across 9 dimensions via AST-grep/grep; emits `TECH_DEBT_AUDIT.md` |

The 5 "NEW" skills here are skill-format equivalents of slash commands that exist in BOTH `.opencode/command/` and `.agents/command/`. They allow the same instructions to be triggered either by an explicit `/command` invocation OR by skill auto-loading on matching prompts. The `codex-qa`, `opencode-qa`, `senpi-qa`, and `tech-debt-audit` skills are `.agents/`-only with no `.opencode/` counterpart and are not command-forms.

## COMMANDS (5 slash commands)

Identical set to `.opencode/command/`:
- `/get-unpublished-changes`
- `/omomomo`
- `/publish`
- `/remove-deadcode`
- `/security-research`

## OTHER CONTENTS

- `background-tasks.json` — Runtime state (parallel to `.opencode/background-tasks.json` during the transition).
- `command/.npmignore`, `skills/.npmignore` — Co-located npm exclusion guards for internal-only assets (`__*`, `.private/`, `.draft/`). Root `.npmignore` does not work for directories listed in `package.json#files` under Bun 1.3.x, so guards live next to published content; `script/package-layout-exclusion.test.ts` enforces them.
- [`skills/AGENTS.md`](skills/AGENTS.md) — Maintenance map for executable skill helpers; the catalog and mirror policy remain here.

## MIGRATION STATUS

| Concern | Plan |
|---------|------|
| Why TWO directories? | `.opencode/` is the legacy layout. `.agents/` is the future-proof name after the harness rename. |
| When does `.opencode/` go away? | After the multi-harness refactor lands and existing users have re-installed. Tracked in [ROADMAP](../ROADMAP.md). |
| What if both exist with conflicting skills? | The skill-loader dedupes by name; higher-priority scope wins. The 4 shared skill entries (`work-with-pr`, `github-triage`, `hyperplan`, `pre-publish-review`) and evaluation workspace match their legacy copies; fix here first if they diverge. |
| Where do NEW skills go? | `.agents/` only. Do NOT add new entries to `.opencode/`. |

## CONVENTIONS

- **All NEW skills go in `.agents/`.** `.opencode/` is frozen aside from drift-sync of the 4 shared skills, evaluation workspace, and command copies.
- **Drift between shared skills is a bug.** When you update a shared skill, update both copies in the SAME commit until `.opencode/` is removed.
- **Slash commands stay duplicated.** Both directories must contain the same `command/*.md` set for the transition window.

## ANTI-PATTERNS

- Never add a skill to `.opencode/` that does not also exist in `.agents/`.
- Never let the 4 shared skills or shared evaluation workspace drift; compare both trees when editing their contents.
- Never delete `.opencode/` until the multi-harness refactor lands.
