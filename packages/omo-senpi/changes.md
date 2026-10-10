## 2026-10-11 - The computer-use component confirms and revokes the foreground-control grant (#9651 B5b)

`components/computer-use/control-confirm.ts` is the human confirm behind `desktop.control.acquire`. It shows upstream's title "Allow foreground computer control?" with the model's reason and the revocation rules. A headless context (`hasUI === false` or no `ui.confirm`) never prompts, and a refusal, an abort or a client that never answers means no grant.

The confirm is bounded at 45 s, under the default 60 s run budget, so an unanswered confirm reports `{ active: false }` rather than a run timeout. The timeout is also handed to `ui.confirm`, so senpi's rpc dialog clears its pending request and a desktop client can show the deadline. `registration-support.ts` `wireComputerControlEvents` sends `control.revoke` on `agent_end` and on `session_shutdown` (before `session.close`), and only to an engine that started.

`scripts/qa/computer-control-rpc-e2e.mjs` proves this through senpi's real `--mode rpc` on the engine's fake backend:
- `no-answer`: the confirm never gets an answer, and no `control.grant` reaches the engine.
- `declined`: no grant.
- `approved`: the grant is audited, and the end of the turn revokes it. This is the positive control.

