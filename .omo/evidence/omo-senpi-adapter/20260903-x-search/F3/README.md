# F3 - live QA on the peer-dependency senpi binary

The committed x-search bundle was exercised with the worktree peer binary `node_modules/.bin/senpi`, version 2026.9.2-4. This is the supported floor for the extension tool-search behavior.

- `senpi` 2026.8.27 (the PATH installations) has a tool-search catalog that indexes MCP tools only.
- The supported 2026.9.2-4 binary indexes extension tools with exposure `search`, allowing `tool_search` to find and activate x_search.
- F3 positive and child both passed with real `x_search results:` headers; two billable x_search calls were used.

Every report records the absolute binary path and version, with scrubbed transcripts, untouched real credential storage, and shredded sandbox auth copies.
