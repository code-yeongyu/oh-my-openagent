# Attribution

`scripts/repo-map.ts` and its `lib/` modules are original TypeScript written for omo. The ranking method they implement (definitions and references per file, a file graph with reference-weighted edges, PageRank with personalization on focus files, file rank distributed onto the definitions other files pull from, output trimmed to a token budget by a binary search over the number of definitions) follows the repository map introduced by aider and the standalone RepoMapper derived from it. No code was copied from either project, and no tree-sitter queries are vendored.

- aider repository map: https://github.com/Aider-AI/aider (Apache License 2.0)
- RepoMapper by Pete Davis: https://github.com/pdavis68/RepoMapper (MIT License)
- The skill text and the "map before you grep" routing were informed by the `repo-map` skill of CodexClaw by lidge-jun (MIT License), https://github.com/lidge-jun/codexclaw at commit e413b144ffa0617093d158a0dde101601bcadee9, which vendors RepoMapper.
