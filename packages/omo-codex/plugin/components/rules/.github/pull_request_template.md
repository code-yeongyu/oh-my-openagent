## Summary

<!-- Brief description, 1-3 bullets -->

-

## Verification

- [ ] `npm run check` (typecheck + biome + build)
- [ ] `npm test` (unit tests)
- [ ] `npm pack --dry-run` (release sanity)
- [ ] Hook smoke-tested locally with `node dist/cli.js hook session-start`
- [ ] Hook smoke-tested locally with `node dist/cli.js hook post-tool-use`

## Codex plugin impact

- [ ] `.codex-plugin/plugin.json` remains valid
- [ ] `hooks/hooks.json` still uses stable Codex hook JSON
- [ ] Session deduplication behavior is covered by tests
- [ ] CHANGELOG entry added for user-facing changes
