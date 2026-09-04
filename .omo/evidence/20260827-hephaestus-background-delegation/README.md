# Hephaestus background delegation QA

## What was tested

- Loaded the current worktree source plugin through OpenCode 1.18.21 using an absolute `file://` plugin path.
- Started a real `opencode serve` process with isolated `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` directories.
- Called the live `/agent` endpoint and manually reviewed the rendered GPT-5.6 Hephaestus configuration.
- Called the live `/experimental/tool/ids` and `/experimental/tool` endpoints for `openai/gpt-5.6-sol` and reviewed the registered category-aware `task` tool.
- Confirmed the isolated OpenCode database path, then read the real host OpenCode session count immediately before the final live endpoint capture and immediately after server shutdown in one shell transaction.

## What was observed

- `health.json` reports `healthy: true` and OpenCode `1.18.21`.
- `agent-hephaestus.json` contains the live `Hephaestus - Deep Agent` registration using `openai/gpt-5.6-sol` with the GPT-5.6 prompt. Manual review confirmed that independent delegated work prefers background execution, dependent work remains synchronous, background delegation is not limited to exploration, and concurrent executors receive disjoint file ownership.
- `task-tool.json` contains the category-aware plugin `task` registration. Both the rendered tool description and the `run_in_background` JSON schema describe asynchronous execution for independent work, synchronous execution when the caller needs the result first, and disjoint file ownership for concurrent writers.
- `tool-ids.json` confirms the plugin `task` tool was registered in the running harness.
- `isolated-db-path.txt` points inside the temporary QA root rather than the host OpenCode data directory.
- `host-db-before-final.txt` and `host-db-after-final.txt` both contain `10778`. The final transactional live QA capture did not add a session to the real host database.
- Docker was unavailable because the local daemon socket did not exist, so the documented local isolated-XDG fallback was used.
- `opencode debug agent` loaded the plugin but did not terminate within 120 seconds. The server/API path initialized successfully and returned the required runtime surfaces, so it replaced that CLI cleanup path rather than retrying it.

## Why this is enough

- The `/agent` response proves the edited Hephaestus prompt reached the real OpenCode adapter and was selected for the configured GPT-5.6 model.
- The `/experimental/tool` response proves both edited tool-contract surfaces reached the schema that OpenCode exposes to the model.
- The isolated database path, healthy live server, and unchanged final host database count prove the QA used the intended source plugin without polluting the user's OpenCode sessions.
- This change only edits authored prompt and tool-description text. Repository policy forbids automated prose contract tests, so runtime retrieval plus manual review is the applicable verification seam.

## Static verification and limitations

- `git diff --check` passed.
- LSP diagnostics could not initialize for the three edited TypeScript files because the worktree contains TypeScript `7.0.2`, which the configured `typescript-language-server` did not recognize as a valid tsserver installation. No fallback build or typecheck was run because the active workspace instruction requires LSP-first verification and forbids build fallback unless explicitly requested.
- The edits only change string literals and introduce no TypeScript control flow, imports, types, or executable schema shape.

## What was omitted

- The full server debug stream was not committed because it primarily contains duplicate-skill discovery warnings and machine-local paths. The exact behavior-bearing API responses are preserved in the JSON artifacts in this directory.
- No provider credential, token, authorization header, environment dump, or private configuration was captured.
