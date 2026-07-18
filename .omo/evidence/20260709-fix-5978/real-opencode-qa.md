# Real OpenCode QA - file-reference-resolver #5978 (closes the #5988 Codex P1 evidence gap)

## Why this file exists
The Codex reviewer raised a P1 on `qa-summary.md`: this change edits
`packages/omo-opencode/src`, and `packages/omo-opencode/src/AGENTS.md` mandates driving
REAL OpenCode for every change under that tree. The original evidence drove only the
exported `formatLoadedCommand` function directly. This file records the mandated
real-OpenCode run.

## Method (reproducible)
1. Build only the runtime bundle (the full `bun run build` is blocked on this host by the
   unrelated vendored `lsp-tools-mcp` / `lsp-daemon` declaration build; OpenCode only needs
   `dist/index.js` to load the plugin):
   - `bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod`
   - `bun run script/patch-node-require-shim.ts`
2. Isolated sandbox: `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME`
   under a throwaway dir; a project with `opencode.json` that loads the built plugin and a
   custom fake model provider; a `/probetoken` command whose wrapper contains documentation
   `@tokens` (`(@path)`, `@ts-ignore`, `oh-my-openagent@latest`) plus one real reference
   `@realref.txt`.
3. A request-logging fake OpenAI-compatible server records the rendered prompt OpenCode
   actually sends to the model.
4. `opencode run "/probetoken" --format json` drives the auto-slash-command executor
   (`chat.message` hook -> `formatCommandTemplate` -> `resolveFileReferencesInText`), which
   replaces the user message part with the rendered wrapper.
5. The same run is repeated with the unfixed `upstream/dev` resolver bundled, for the
   before/after.

## Result

| Marker in the rendered wrapper | dev (before) | head (after) |
|---|---|---|
| `<auto-slash-command>` executor ran | 2 | 2 |
| `(@path)` preserved | 0 | 2 |
| `@ts-ignore` preserved | 3 | 5 |
| `oh-my-openagent@latest` preserved | 0 | 2 |
| real `@realref.txt` inlined (`INLINED_REAL_CONTENT_MARKER_5978`) | 2 | 2 |
| `[file not found: ...]` corruption | 6 | 0 |

Full rendered wrappers: `real-opencode-dev-rendered.txt` (before), `real-opencode-fix-rendered.txt` (after).

## Isolation
- `opencode db path` -> `<SANDBOX>/xdg/data/opencode/opencode.db` (not the real DB).
- Real `~/.local/share/opencode/opencode.db` session count: 2564 before, 2564 after. The QA
  never touched the real DB.

## Verdict
Through a real `opencode` v1.18.1 process with the built plugin loaded, the unfixed resolver
corrupts `(@path)`, `@ts-ignore`, and `@latest` into `[file not found: ...]` fragments
(reproducing #5978), while the fix leaves them verbatim and still inlines genuine `@file`
references. This is the AGENTS.md-mandated real-OpenCode surface the Codex P1 asked for.
