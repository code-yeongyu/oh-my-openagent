# shared-skills — Cross-Harness SKILL.md Bundle (Skills)

**Generated:** 2026-06-17

## OVERVIEW

Hand-authored, cross-harness skill bundle shared between the OpenCode and Codex editions. Pure data — no logic, no transform inside the package. The only code is `index.mjs`, which exports `sharedSkillsRootPath()` returning the absolute path to `skills/`. Package: `@oh-my-opencode/shared-skills` (`files`: `index.mjs`, `index.d.ts`, `skills`).

## SKILLS (17 under `skills/<name>/`)

`programming`, `debugging`, `frontend`, `visual-qa`, `ast-grep`, `git-master`, `refactor`, `review-work`, `start-work`, `ulw-plan`, `ulw-research`, `init-deep`, `remove-ai-slops`, `lsp-setup` (shared) + `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor` (Codex-only, `lcx-` prefix).

Per-skill layout: `SKILL.md` (YAML frontmatter `name:` + single-line `description:` with triggers) + optional `references/` (the real content; SKILL.md is a router/index) + optional `scripts/` + optional `agents/openai.yaml` (5 skills carry the Codex agent role declaration).

## PIPELINE

```
skills/ (source)
  ├─ build:shared-skills-assets (root) → cp -R skills dist/skills          # literal copy, no transform
  ├─ skills-loader-core → loadSkillsFromDir(sharedSkillsRootPath(), scope:"shared")   # OpenCode runtime
  └─ omo-codex/plugin/scripts/sync-skills.mjs → plugin/skills/             # copy + adaptSkillForCodex()
        (inserts Codex Harness Tool Compatibility sections; overlays start-work/review-work;
         filters out *.test.* ) → ships to ~/.codex/.../skills/
```

## FRONTEND THIRD-PARTY REFS — SUBMODULE-ONLY + BUILD-MATERIALIZE (DMCA-safe)

The `frontend` skill's brand / taste-skill / ui-ux-db references are third-party content. Under the DMCA-safe model the repo holds ZERO committed copies; each upstream is a pinned git submodule under `upstreams/<name>` (NOT under `skills/`, so it never lands in the tarball), and the build materializes the referenced files VERBATIM, path-mapped, into `skills/frontend/references/{design,ui-ux-db}`.

```
upstreams/{open-design,taste-skill,ui-ux-pro-max}   # pinned submodules (provenance, build input)
  └─ packages/shared-skills/scripts/frontend-refs-manifest.mjs   # single source of truth: partition + upstream path map
       └─ packages/shared-skills/scripts/materialize-frontend-refs.mjs   # verbatim path-mapped copy → references/{design,ui-ux-db}
            └─ chokepoint: packages/omo-codex/plugin/scripts/materialize-shared-upstreams.mjs  (submodule init + materialize)
                 • PREPENDED to the codex plugin build chain BEFORE sync-skills.mjs (every ship path runs it)
                 • root build:shared-skills-assets + root prepack also run it
```

- The materialized files are GITIGNORED (`skills/frontend/.gitignore`) so they are never committed; a `skills/frontend/.npmignore` overrides that `.gitignore` for npm pack so the materialized refs DO ship. The lazycodex marketplace sync is a raw file copy and ships whatever is on disk after the plugin build materialized it.
- The §4 project-original design docs (`README.md`, `_INDEX.md`, `design-system-architecture.md`, `react-dev-tooling-skill.md`) and all of `references/perfection/*` stay committed (un-ignored in `.gitignore`).
- ATTRIBUTION pins each upstream's SHA (`Pinned upstream commit:`); `script/update-frontend-upstreams.mjs` bumps the submodules + rewrites the pins (`--check` verifies pins == submodule HEAD, no network). `provenance-gate.test.ts` fails CI if any third-party path is committed, the materialize set is missing, or a pin drifts.
- Submodule init is non-fatal ONLY in `script/agent/setup.sh` (offline devs get a working tree minus brand refs); the plugin build chain runs it `--strict` so CI/publish ship a complete package.

## CONSUMERS

- `skills-loader-core` (`workspace:*`) — default `skillsRootPath` for builtin/shared skill loading.
- `omo-opencode/src/cli/install-ast-grep-sg.ts` — finds the ast-grep skill dir for binary install.
- `omo-codex/plugin` (`file:` dep) — `sync-skills.mjs` is the only transformer.

## NOTES

- **No generator builds the skills** — they are authored by hand; the build step is a plain `cp -R`.
- **Test files (`*.test.ts/.mjs`) are excluded** when Codex copies skills.
- **`lcx-` prefix = Codex-only** (no OpenCode counterpart). Frontmatter has NO `location:` field (unlike `.agents/skills/`).
- **Packaging is pinned** by `omo-opencode/src/shared-skills-package.test.ts` (workspace inclusion + `files` entries + every skill parses).
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
