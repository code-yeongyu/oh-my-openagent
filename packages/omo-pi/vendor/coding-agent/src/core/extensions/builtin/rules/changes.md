# changes.md — rules (vendored)

Vendored from [`code-yeongyu/pi-rules`](https://github.com/code-yeongyu/pi-rules) (see `external-versions.json`).

## Senpi adaptations vs upstream

- Imports rewritten by `scripts/vendor-transform.mjs`: `@mariozechner/pi-tui` -> `@earendil-works/pi-tui`; `@mariozechner/pi-coding-agent` symbols -> `../../types.ts` (and `Theme` -> `modes/interactive/theme/theme.ts`); relative `.js` import suffixes -> `.ts`.
- `ui/dynamic-border.ts` and `ui/rules-banner.ts`: constructor parameter properties (`private readonly …`) -> explicit fields + constructor assignment (senpi's root tsconfig is `erasableSyntaxOnly`; parameter properties are disallowed).
- Runtime dep `picomatch` (+ `@types/picomatch`) added to `package.json`.
- No behavior changes. Registers `/rules` and `/reload-rules` and discovers rule files from `.sisyphus/rules`, `.claude/rules`, `.cursor/rules`, `.github/instructions`, `AGENTS.md`, `CLAUDE.md`.

## Conflict zones

Re-vendoring overwrites these files; this is a MANUAL_PACKAGES entry in `scripts/sync-builtin-extensions.mjs` (metadata only, no auto file-sync). Re-apply the parameter-property patches after re-running the transform, then re-check `npm run check`.
