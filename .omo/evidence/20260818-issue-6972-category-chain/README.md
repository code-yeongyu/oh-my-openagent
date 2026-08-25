# Issue #6972 OpenCode QA evidence

## What was tested

- `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check` verified the required OpenCode QA dependencies and isolated-XDG harness.
- `bash .omo/evidence/20260818-issue-6972-category-chain/live-category-chain-qa.sh` loaded this branch's freshly built `dist/index.js` in OpenCode 1.18.18 and ran a real `opencode run --format json` session.
- The isolated project configured category `verifier` with the ordered chain `opencode/issue-6972-model-does-not-exist -> opencode/deepseek-v4-flash-free`. The parent model was instructed to invoke the real `task` tool synchronously, and the child was required to return `CHILD_OK` before the parent returned `PARENT_OK`.

## What was observed

- The real run exited 0 and emitted one `task` tool event.
- Both `CHILD_OK` and `PARENT_OK` were observed, proving the delegated child session completed and handed control back to the parent.
- The branch-local plugin log recorded the selected available model `opencode/deepseek-v4-flash-free` six times.
- Stderr contained neither `ProviderModelNotFoundError` nor the configured nonexistent model ID; the child session completed on the available second entry.
- The real user OpenCode database session count was 5861 before and 5861 after; all spawned sessions were confined to the disposable HOME/XDG sandbox.

## Why this is enough

The regression is specifically at the boundary between category model selection and OpenCode's early provider model resolution. This QA drives that real boundary through the shipped plugin bundle and the public `task` tool surface: an unavailable first configured entry is removed before OpenCode resolves the child model, the second configured entry creates a real child session, and the parent receives the result. Focused and neighbouring Bun suites separately cover order preservation, fuzzy matching, per-entry settings, the all-unavailable error, and cold-cache compatibility.

## What was omitted

- The disposable sandbox, isolated SQLite database, auth copy, raw NDJSON transcript, and full plugin log were deleted after assertions completed.
- Credentials, tokens, auth JSON, environment dumps, and private model/provider details were never copied into evidence.
- Only assertion counts and a sanitized stderr tail are retained in `live-category-chain-qa.txt`.
