# PR #6339 rebase QA

## What was tested

The rebased candidate was built and driven through OpenCode 1.18.14's real
non-interactive CLI in an isolated XDG sandbox. The sandbox loaded this
worktree's `dist/index.js`, registered Sisyphus as a primary agent with
`openai/gpt-5.6-luna`, and configured its conditional `file://` prompt append
to exclude `claude` and `gpt` model IDs.

Two fresh requests used the same registered Sisyphus agent with different
runtime models:

```text
opencode run --agent "Sisyphus - ultraworker" --model opencode-go/glm-5.2 --format json <probe>
opencode run --agent "Sisyphus - ultraworker" --model openai/gpt-5.6-luna --format json <probe>
```

The probe asked for `CELESTIA_PRESENT` only when the model-visible system
prompt carried the conditional append, otherwise `CELESTIA_ABSENT`.

## What was observed

- GLM returned `CELESTIA_PRESENT`; see `glm.jsonl`.
- GPT returned `CELESTIA_ABSENT`; see `gpt.jsonl`.
- The host OpenCode session count remained `224`; the sandbox contained exactly
  two sessions; see `isolation.txt`.
- `agent-registration.txt` records the candidate plugin path and the fixed
  registration-time model.

## Why it is enough

Only the request-time model changed. The opposite responses prove the rebased
runtime reconciler re-evaluates the conditional append from that runtime model
rather than leaking the configured GPT decision. The GLM response proves the
file-backed append reached the real model-visible system prompt; the GPT
response proves the excluded conditional content did not leak.

The scoped Bun tests separately cover conditional-then-always source ordering,
within-group ordering, include and exclude precedence, special agent paths,
and compaction isolation.

## What was omitted

The sandbox received only copied OpenCode account and auth state. No auth files,
tokens, private configuration, or provider request bodies are included here.
Earlier invalid fixture attempts used an unaddressable dynamic-agent name and
were discarded rather than represented as QA evidence.
