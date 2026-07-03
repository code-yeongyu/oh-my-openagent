# changes.md — nested-agents-md (vendored)

Vendored from [`code-yeongyu/pi-nested-agents-md`](https://github.com/code-yeongyu/pi-nested-agents-md) (see `external-versions.json`).

## Senpi adaptations vs upstream

- Imports rewritten by `scripts/vendor-transform.mjs`: `@earendil-works/pi-coding-agent` symbols -> `../../types.ts`; relative `.js` import suffixes -> `.ts`. (This package already used `@earendil-works/pi-*` upstream, so only the coding-agent symbols and suffixes moved.)
- `core/errors.ts`: `InjectionFileReadError` constructor parameter property (`public readonly path`) -> explicit field + constructor assignment (senpi's root tsconfig is `erasableSyntaxOnly`; parameter properties are disallowed).
- No behavior changes. Registers the `/nested-agents` command and injects nearby `AGENTS.md` on nested reads.

## Conflict zones

Re-vendoring overwrites these files; this is a MANUAL_PACKAGES entry in `scripts/sync-builtin-extensions.mjs` (metadata only, no auto file-sync). Re-apply the parameter-property patch after re-running the transform, then re-check `npm run check`.
