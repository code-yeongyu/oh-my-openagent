# changes.md — websearch (vendored)

Vendored from [`code-yeongyu/pi-websearch`](https://github.com/code-yeongyu/pi-websearch) (see `external-versions.json`).

## Senpi adaptations vs upstream

- Imports rewritten by `scripts/vendor-transform.mjs`: `@mariozechner/pi-{ai,tui}` -> `@earendil-works/pi-{ai,tui}`; `@mariozechner/pi-coding-agent` symbols -> `../../types.ts` (and `Theme` -> `modes/interactive/theme/theme.ts`); relative `.js` import suffixes -> `.ts`.
- No behavior changes. Registers the `web_search` tool unconditionally and defers to provider-native web search (`anthropic-web-search` / `openai-web-search` inject at request level, so there is no tool-registry name clash).

## Conflict zones

Re-vendoring overwrites these files; this is a MANUAL_PACKAGES entry in `scripts/sync-builtin-extensions.mjs` (metadata only, no auto file-sync). Port upstream changes by re-running the transform, then re-check `npm run check`.
