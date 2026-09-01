# Codex app-server — the first-party QA channel

The app-server is how a host (IDE, our QA harness) drives Codex programmatically.
We speak its protocol directly so we can read the **structured notification
stream** — including `hook/started` / `hook/completed`, which is the
authoritative proof that an omo plugin hook fired in a live turn.

Verified against `codex-cli 0.139.0`. Source citations are `path:line` under
`../codex/codex-rs/`.

## Transport & framing

- Start with `codex app-server` (no subcommand runs the server). Implemented by
  the `codex-app-server` crate; entry `app-server/src/lib.rs:429`.
- Default transport is **stdio**, framing is **newline-delimited JSON** (one
  message per line) — `app-server-transport/src/transport/stdio.rs:46-88`.
- It is NOT standard JSON-RPC 2.0: there is **no `"jsonrpc"` field**. Requests
  are `{id, method, params}`; notifications are `{method, params}`
  (`app-server-protocol/src/jsonrpc_lite.rs`). Field names are camelCase.

Confirm the method set for the installed binary:

```bash
codex app-server generate-json-schema --out "$(mktemp -d)"   # ClientRequest.json / ServerNotification.json
```

## Drive one turn (the sequence the driver uses)

```jsonc
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex-qa","version":"0.1.0"},"capabilities":{"experimentalApi":true,"requestAttestation":false}}}
{"method":"initialized"}                                            // notification, REQUIRED, no id
{"id":2,"method":"thread/start","params":{"cwd":"/abs/workdir"}}    // -> result.thread.id
{"id":3,"method":"turn/start","params":{"threadId":"<id>","input":[{"type":"text","text":"say hello"}]}}  // -> result.turn.id
```

Read stdout line-by-line and collect:

- `hook/started` / `hook/completed` — `params.run.eventName` (e.g. `sessionStart`,
  `userPromptSubmit`, `stop`), `params.run.status` (`running` → `completed`),
  `params.run.source` (`plugin`). **This is the plugin-fired proof.**
- `item/completed` where `item.type == "agentMessage"` — `item.text` is the
  assistant message.
- `turn/completed` — stop when `turn.status == "completed"` (or `"failed"` with
  `turn.error`) for your `turnId`.

`scripts/lib/app-server-client.mjs` implements exactly this and exits non-zero
unless the turn completes and every `EXPECT_HOOK` event reaches `completed`.

## Why a mock model

A turn needs a model. We point a custom `model_provider` at the local
`scripts/lib/mock-model.mjs` (OpenAI Responses SSE), so the turn runs with NO
real API call. A non-OpenAI provider needs no auth (`requires_openai_auth`
defaults false). The driver injects the provider via `-c` overrides — see
[isolation.md](./isolation.md).

## Observed result on 0.139.0

With omo installed in an isolated `CODEX_HOME`, one `ulw: say hello` turn emits
`hook/*` for `sessionStart` (rules, telemetry, bootstrap, auto-update),
`userPromptSubmit` (rules, ultrawork, ulw-loop), and `stop`
(start-work-continuation), then the mock assistant message and `turn/completed`.
`scripts/app-server-drive.sh --plugin` asserts this end to end.
