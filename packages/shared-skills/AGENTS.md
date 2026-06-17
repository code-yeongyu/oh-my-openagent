# shared-skills — Cross-Harness SKILL.md Bundle (Skills)

**Generated:** 2026-06-17

## OVERVIEW

Hand-authored, cross-harness skill bundle shared between the OpenCode and Codex editions. Pure data — no logic, no transform inside the package. The only code is `index.mjs`, which exports `sharedSkillsRootPath()` returning the absolute path to `skills/`. Package: `@oh-my-opencode/shared-skills` (`files`: `index.mjs`, `index.d.ts`, `skills`).

## SKILLS (17 under `skills/<name>/`)

`programming`, `debugging`, `frontend`, `visual-qa`, `ast-grep`, `git-master`, `refactor`, `review-work`, `start-work`, `ulw-plan`, `ultraresearch`, `init-deep`, `remove-ai-slops`, `lsp-setup` (shared) + `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor` (Codex-only, `lcx-` prefix).

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
