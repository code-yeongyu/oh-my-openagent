# Live root x-search QA

Runs use the worktree peer-dependency binary `node_modules/.bin/senpi`, version 2026.9.2-4. The driver records its absolute `senpiBin` and first-line `senpiVersion` in every scenario report.

- Negative: `tool_search` executed; X posts returned `No tools matched`, while the extension control query matched `x_probe_tool`; zero x_search calls.
- Positive: transcript-derived `toolCalls` are `["tool_search", "x_search"]`, with one real `x_search results:` header.
- Reload: two real x_search results headers across the continuation sequence, with three registrations.

All runs report the real Senpi credential store untouched. Seeded xAI auth copies were shredded before sandbox removal, and evidence contains no credential values.
