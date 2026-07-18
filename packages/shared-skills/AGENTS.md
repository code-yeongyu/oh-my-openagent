# shared-skills — Cross-Harness SKILL.md Bundle (Skills)

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

Hand-authored, cross-harness skill bundle shared between the OpenCode and Codex editions. Mostly authored skill data, with skill-owned scripts/assets when required and no transform inside the package. `index.mjs` exports `sharedSkillsRootPath()` returning the absolute path to `skills/`. Package: `@oh-my-opencode/shared-skills` (`files`: `index.mjs`, `index.d.ts`, `skills`).

## SKILLS (16 under `skills/<name>/`)

`programming`, `debugging`, `frontend`, `visual-qa`, `ast-grep`, `coding-agent-sessions`, `git-master`, `refactor`, `review-work`, `start-work`, `ulw-plan`, `ulw-research`, `init-deep`, `remove-ai-slops`, `lsp-setup`, `ultimate-browsing`.

The Codex-only `lcx-report-bug`, `lcx-contribute-bug-fix`, and `lcx-doctor` skills live under `packages/omo-codex/plugin/components/lcx/skills/`; they are no longer authored in this package.

Per-skill layout: `SKILL.md` (YAML frontmatter `name:` + single-line `description:` with triggers) + optional `references/` (the real content; SKILL.md is a router/index) + optional `scripts/` + optional `agents/openai.yaml` (3 skills carry the Codex agent role declaration).

## PIPELINE

```
skills/ (source)
  ├─ build:shared-skills-assets (root) → cp -R skills dist/skills          # literal copy, no transform
  ├─ skills-loader-core → loadSkillsFromDir(sharedSkillsRootPath(), scope:"shared")   # OpenCode runtime
  └─ omo-codex/plugin/scripts/sync-skills.mjs → plugin/skills/             # the only transformer
        1. copies 10 omo-codex COMPONENT skills FIRST (comment-checker, lcx-*, lsp, rules,
           teammode, ulw-loop, ulw-plan, ultrawork from plugin/components/*/skills/*); same-named
           shared skills are skipped → ulw-plan/ultrawork in Codex come from components, NOT from here
        2. copies remaining shared skills
        3. adaptSkillForCodex(): inserts Codex Harness Tool Compatibility sections; overlays
           start-work/review-work; writes agents/openai.yaml display metadata with the "(OmO) "
           prefix; filters out tests, caches, and source metadata
        → ships to ~/.codex/.../skills/
```

## FRONTEND THIRD-PARTY REFS — SUBMODULE-ONLY + BUILD-MATERIALIZE (DMCA-safe)

The `frontend` skill's brand / taste-skill / ui-ux-db / designpowers references are third-party content. Under the DMCA-safe model the repo holds ZERO committed copies; each upstream is a pinned git submodule under `upstreams/<name>` (NOT under `skills/`, so it never lands in the tarball), and the build materializes the referenced files path-mapped into `skills/frontend/references/{design,ui-ux-db,designpowers/vendor}`. File bodies are copied verbatim, except materialized `SKILL.md` frontmatter may normalize an unquoted single-line `description:` scalar into a JSON-quoted YAML string so Codex/OpenCode frontmatter parsing stays deterministic; the description text itself is unchanged.

```
upstreams/{open-design,taste-skill,ui-ux-pro-max,designpowers}   # pinned submodules (provenance, build input)
  └─ packages/shared-skills/scripts/frontend-refs-manifest.mjs   # single source of truth: partition + upstream path map
       └─ packages/shared-skills/scripts/materialize-frontend-refs.mjs   # path-mapped copy + SKILL.md description quoting → references/{design,ui-ux-db}
            └─ chokepoint: packages/omo-codex/plugin/scripts/materialize-shared-upstreams.mjs  (submodule init + materialize)
                 • PREPENDED to the codex plugin build chain BEFORE sync-skills.mjs (every ship path runs it)
                 • root build:shared-skills-assets + root prepack also run it
```

- The materialized files are GITIGNORED (`skills/frontend/.gitignore`) so they are never committed; a `skills/frontend/.npmignore` overrides that `.gitignore` for npm pack so the materialized refs DO ship. The lazycodex marketplace sync is a raw file copy and ships whatever is on disk after the plugin build materialized it.
- The §5 project-original design docs (`README.md`, `_INDEX.md`, `aside.md`, `design-system-architecture.md`, `react-dev-tooling-skill.md`) and all of `references/perfection/*` stay committed (un-ignored in `.gitignore`).
- ATTRIBUTION pins each upstream's SHA (`Pinned upstream commit:`); `script/update-frontend-upstreams.mjs` bumps the submodules + rewrites the pins (`--check` verifies pins == submodule HEAD, no network). `provenance-gate.test.ts` fails CI if any third-party path is committed, the materialize set is missing, or a pin drifts. `materialize-frontend-refs.test.ts` covers the allowed `SKILL.md` description quoting normalization.
- Submodule init is non-fatal ONLY in `script/agent/setup.sh` (offline devs get a working tree minus brand refs); the plugin build chain runs it `--strict` so CI/publish ship a complete package.

## CONSUMERS

- `skills-loader-core` (`workspace:*`) — default `skillsRootPath` for builtin/shared skill loading.
- `omo-opencode/src/cli/install-ast-grep-sg.ts` — finds the ast-grep skill dir for binary install.
- `omo-codex/plugin` (`file:` dep) — `sync-skills.mjs` is the only transformer.

## NOTES

- **No generator builds the skills** — they are authored by hand; the build step is a plain `cp -R`.
- **Test files, caches, and source metadata are excluded** when Codex copies skills.
- **`lcx-` prefix = Codex-only** (no OpenCode counterpart). Frontmatter has NO `location:` field (unlike `.agents/skills/`).
- **Packaging is pinned** by `omo-opencode/src/shared-skills-package.test.ts` (workspace inclusion + `files` entries + every skill parses).
- **Skill CONTENT is PROSE — do NOT pin its wording with a test.** A skill body is instructions the model reads; asserting what it *says* (`toContain` a sentence, `not.toContain` old wording, word/char counts) guards a diff, not behavior, and blocks every legitimate edit — see `.omo/rules/test-discipline.md` §PROMPT TESTS. Guard only what a MACHINE consumes: packaging (`omo-opencode/src/shared-skills-package.test.ts`, above), personal-token scrubbing (`depersonalization-gate.test.ts` — a security exclusion), the third-party manifest (`frontend-thirdparty-manifest.test.ts`), and `upstreams.test.ts`. A pure-prose skill edit ships on review with NO new test; the prose-pinning contract tests that used to sit here were removed as pretend-coverage.
- **ulw-plan is dual-maintained by hand** (here AND `omo-codex/plugin/components/ultrawork/skills/ulw-plan/`) — sync-skills does NOT copy the shared version to Codex; keep both in step.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
