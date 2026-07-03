# changes.md — webfetch (vendored)

Vendored from [`code-yeongyu/pi-webfetch`](https://github.com/code-yeongyu/pi-webfetch) (see `external-versions.json`).

## Senpi adaptations vs upstream

- Imports rewritten by `scripts/vendor-transform.mjs`: `@mariozechner/pi-{ai,tui}` -> `@earendil-works/pi-{ai,tui}`; `@mariozechner/pi-coding-agent` symbols -> `../../types.ts` (and `Theme` -> `modes/interactive/theme/theme.ts`); relative `.js` import suffixes -> `.ts`.
- `webfetch/fetcher.ts`: `buildHeaders` return type `HeadersInit` -> `Record<string, string>` (senpi's root tsconfig has no DOM lib, so the `HeadersInit` global is unavailable; the value is already a plain string record).
- Runtime deps `@mozilla/readability`, `jsdom`, and `turndown` (+ `@types/jsdom`, `@types/turndown`) added to `package.json`.
- HTML markdown/text responses now pass through Readability before conversion so reader-style article content is returned without nav/header/footer/aside/script page chrome. Registers the `webfetch` tool, gated by `PI_WEBFETCH` (default on).
- Tistory-style article containers are preferred over surrounding blog chrome, noisy related-post/sidebar blocks are stripped from the cloned article, and text conversion uses a DOM pass to preserve readable line breaks.

## Conflict zones

Re-vendoring overwrites these files; this is a MANUAL_PACKAGES entry in `scripts/sync-builtin-extensions.mjs` (metadata only, no auto file-sync). Re-apply the `HeadersInit` patch and Tistory article/noise selector behavior after re-running the transform, then re-check `npm run check`.
