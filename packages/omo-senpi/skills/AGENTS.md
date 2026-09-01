# skills

Native Senpi skills authored directly against the Senpi tool surface (not ported from Codex or the shared pool). `plugin/scripts/sync-skills.mjs` ships the native registry verbatim; shared-pool skills (ulw-execute, git-master, ...) get senpi overlays at sync time. Earned by score: 10 skill dirs with their own authoring contract.

## WHERE TO LOOK

| Skill | Role |
|-------|------|
| `mass-ulw/` | Chained-dag orchestration at repo scale (multi-run composition, size formula, node categories). `references/planning.md` is REQUIRED reading before building any dag: wave doctrine, node prompt contract, failure playbook. |
| `ultrawork/` | Senpi-native ultrawork directive source; its body is embedded into `src/components/ultrawork/generated-directive.ts` by `plugin/scripts/embed-directive.mjs` (build fails on non-senpi harness tokens). |
| `ulw-plan/` | Read-only planning lifecycle: draft -> plan with explicit approval; `scripts/scaffold-plan.mjs` scaffolds guarded `.omo` artifacts. |
| `ulw-loop/` | Goal/QA lifecycle loop; component-owned native source, shipped verbatim. |
| `ulw-research/` | Claim-graph research orchestration: claims enter `claim-graph.md` as `verified-claims`; unsupported claims stay unresolved/refuted. |
| `hyperplan/` | Adversarial cross-critique planning; debate rounds and planner handoff must not be skipped. |
| `init-deep/` | Hierarchical AGENTS.md generation via a size-formula dag map-reduce (quick scanners -> high writers, ALWAYS-REDUCE); senpi-local override shadowing the shared-pool copy. |
| `dag-library/` | Store a dag definition once and re-run it by name; loads through `plugin/runtime/dag/library.js`. |
| `onboarding/` | First-run onboarding; `qa-validator.sh` pins the skill contract (front matter `name: onboarding`), `qa-savings-fixture.sh` expects `qa-savings-fixture: OK`. |
| `give-me-tips/` | Explains any senpi tip in depth (`Tip:` lines incl. the Fable-5-refusal fallback tip); queries `senpi --list-tips` first, checks what THIS user can see, verifies feature code before explaining. |

## CONVENTIONS

- Every skill is a directory with a mandatory `SKILL.md` (YAML front matter, `name:` pinned by the onboarding validator). Supporting material splits into `references/` (loaded selectively by the parent skill) and `scripts/`.
- Orchestration contracts are prose plus exact templates: standalone node prompts with TASK/SCOPE/VERIFY/STOP WHEN, `category` routing, disjoint write scopes, bounded fan-in, final verification node. `dependsOn` is ordering only; data flows through files or eval-generated prompts.
- Markdown headings, serialized field names, and documented paths are contracts: `PLAN_SECTION_HEADERS`, `.omo/drafts/<slug>.md`, `.omo/plans/<slug>.md`, `claim-graph.md`, `verified-claims`, `team_run_id`.
- `scaffold-plan.mjs` targets Node and Bun, `node:*` built-ins only, deterministic output, refuses unsafe paths, symlinks, non-`.md` targets, and invalid slugs; preserves edited artifacts unless `--reset [--force]`.

## ANTI-PATTERNS

- init-deep: the main session NEVER reads raw chunk reports or node outputs (ALWAYS-REDUCE); scanners never write AGENTS.md; existing files are read before overwrite; generated managed blocks are never hand-edited.
- mass-ulw: no dag before reading `references/planning.md`; no dependency edges merely to pass data; no code-changing graph without a final verification node.
- ulw-plan: no self-activation; no implementer dispatch (read-only lane); waits for explicit approval; never begins execution.
- ulw-loop: no sleep/timed polling for async state. ultrawork: no `tmux capture-pane` as visual evidence; paired cleanup required.
- Workers never edit outside the assigned scope and never commit.

## COMMANDS

```bash
bash skills/onboarding/qa-validator.sh
bash skills/onboarding/qa-savings-fixture.sh
node skills/ulw-plan/scripts/scaffold-plan.mjs <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]
```
