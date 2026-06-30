# Real OpenCode Ralph event-hook probe

## Purpose

Prove that a lifecycle event matching the changed Ralph `event` hook activity path reaches the live OpenCode event surface, not just the SSE self-test `server.connected` plumbing.

## Harness

- Started isolated `opencode serve` with sandboxed `XDG_*` and `HOME`.
- Loaded the repo-local plugin from `packages/omo-opencode/src/index.ts`.
- Configured a fake OpenAI-compatible provider from `.agents/skills/opencode-qa/scripts/lib/fake-openai-server.mjs`.
- Created a sandbox session and sent a `prompt_async` request.
- Watched `/event?directory=<sandbox>` for `message.part.delta`.

## Result

- Result: pass.
- First matching event: `{"type":"message.part.delta","sessionID":"ses_0e515b7dbffeqeewkVW1sTyr86"}`.
- This event type is handled by `getRuntimeRetryActivitySessionID()` and reaches the changed Ralph `event` hook activity path.

## Isolation

- Real OpenCode DB session count: `3046 -> 3046`.
- Sandbox DB session count: `1`.
- The generated session lived only in the sandbox DB.

## Captured output artifact

- `redacted-probe-output.txt` contains the command result, isolation receipt, and selected `message.part.delta` SSE event line used to prove the hook-relevant lifecycle event reached the live event surface.
- Raw server logs were not committed because they are noisy and include transient local ports/paths; the committed artifact preserves the reviewer-relevant output without auth material or private runtime noise.
