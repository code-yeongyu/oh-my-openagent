### Fixed

- A thread no engine runs on this device (closed, or its terminal exited) answers every thread tool the way a send to it does: `thread_read` reads its session file (`source: "session_jsonl"`), and `thread_interrupt`, `thread_rename`, `thread_set_model` and `thread_set_reasoning` answer `not_resumable`, the same refusal a thread that ended on another device gets, instead of `not_found` while `thread_send` queued to it.
- `thread_create` on this device answers the same thread summary as on another device (id, name, folder, state, times and link) instead of the engine's whole session state.
- `thread_create` on this device in a folder outside the caller's workspace says so: the result adds `workspace_scope: "outside"` and `scope_next_action`, because every thread tool answers that thread `scope_denied` unless `all_scope` is set.

<!-- changes-log: packages/omo-senpi/changes.md -->
## 2026-11-14 - thread tools: one answer on this device and on another one

`control/locate.ts` resolves a control tool's address against the send address book (`sendAddressBook`: the session files an address names are looked up when no endpoint lists it), so the control tools and `thread_send` find the same threads; `tools/read-ops.ts` reads any not-running thread that has a session file here, not only one whose endpoint died. `control/session-host.ts` `openedThread` is the one create summary both session hosts answer. `control/local-session-host.ts` `workspaceNote` adds the out-of-workspace note to a thread this device opened.
