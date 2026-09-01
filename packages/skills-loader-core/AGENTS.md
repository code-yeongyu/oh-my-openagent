# skills-loader-core — Skill Loading + Matching (Core)

**Generated:** 2026-08-24 (f3642fcda)

## OVERVIEW

Harness-neutral skill loading, builtin skill, runtime skill, and skill matching primitives.
Package `@oh-my-opencode/skills-loader-core`.
Confirmed by grep: consumed by `omo-opencode` skill features in ~70 files across `src/features/builtin-skills`, `src/features/opencode-skill-loader`, `src/features/opencode-runtime-skills`, `src/tools/skill`, and `src/hooks/auto-slash-command`.

## SUBSYSTEMS

| Area | Purpose | Sub-AGENTS.md |
|------|---------|---------------|
| `features/opencode-skill-loader/` | Multi-source SKILL.md discovery, parse, merge, deduplication | [src/features/opencode-skill-loader/AGENTS.md](src/features/opencode-skill-loader/AGENTS.md) |
| `features/builtin-skills/` | Built-in skill catalog (git-master, browser variants, frontend, debugging, visual-qa, security, review-work, team-mode) | [src/features/builtin-skills/AGENTS.md](src/features/builtin-skills/AGENTS.md) |
| `features/opencode-runtime-skills/` | Runtime security skill source (security-research, security-review) | — |
| `tools/skill/` | Skill name matching and scope priority sorting | — |
| `hooks/auto-slash-command/` | Slash command detection and processed command store | — |
| `shared/` | Skill path resolver, config dir discovery, plugin identity, shell env | — |
| `config/` | Git env prefix and skills config schema | — |

## NOTES

- **Exports:** barrel root plus subpath exports for `./opencode-skill-loader`, `./builtin-skills`, `./opencode-runtime-skills`, `./skill`, `./auto-slash-command`, `./shared/*`, and `./config/*`.
- **Skill matching:** `tools/skill/skill-matcher.ts` provides `matchSkillByName()`, `matchCommandByName()`, and `findPartialMatches()`; ambiguous short-name matches refuse to resolve.
- **Runtime skill source:** `features/opencode-runtime-skills/` exports `selectRuntimeSecuritySkills()` and `createRuntimeSkillSourceServer()`; dual-runtime (Bun.serve preferred, Node http fallback), loopback-only, `cache-control: no-store`, 404 on unknown paths.
- **123 TypeScript files** under `src/` (86 non-test). Barrel entry `src/index.ts`.

Parent: [packages/AGENTS.md](../AGENTS.md)
