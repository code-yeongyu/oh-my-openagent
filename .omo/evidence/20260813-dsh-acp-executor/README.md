# call_dsh_agent — DeepSeek Harness ACP executor tool

**WHAT WAS TESTED:** a new conditional tool `call_dsh_agent` that delegates a
standalone subtask to a fresh DeepSeek Harness (dsh) agent over the Agent
Client Protocol (newline-delimited JSON-RPC over stdio): spawn ->
initialize -> session/new -> session/prompt -> collect agent_message_chunk
-> settle on the ACP stop reason. Gated by the new `dsh` config block
(enabled/command/args/cwd/permission/timeout_ms), default off.

**WHAT WAS OBSERVED:**
1. `bun test packages/omo-opencode/src/tools/dsh-agent/` -> 8 pass / 0 fail.
   Integration tests drive a REAL fake ACP child process (fixtures/
   fake-dsh-acp-server.mjs): happy path returns committed text + end_turn;
   permission request with reject policy settles as refusal; allow_once
   grants the first allow option; rpc error rejects with the message; a
   hanging child is killed after timeout_ms; an aborted signal rejects
   immediately.
2. `bun test packages/omo-opencode/src/config/` -> 141 pass / 0 fail
   (dsh schema parses, defaults hold).
3. `bun test packages/omo-opencode/src/plugin/tool-registry.test.ts` -> 9 pass;
   tool-execute-before + monitor + team-mode registry tests -> 23 pass.
   The tool only registers when dsh.enabled is true, so default tool counts
   are unchanged.
4. `bun test packages/omo-opencode/src/tools/` -> 1049 pass / 0 fail.
5. `bun run typecheck` -> exit 0; `bun run build` -> exit 0.

**WHY IT IS ENOUGH:** the protocol exchange is pinned by a real child process
over real pipes (not mocked transport); every branch (settle, permission
reject/allow, error, hang-timeout, abort) has a deterministic test. The
registry gating proves the default install is unaffected.

**WHAT WAS OMITTED:** a live run against the real @deepseek-ai/dsh ACP server
(the package is a developer preview released today; the exact CLI entry may
change). The wire contract comes from their published acp/acp README and
codec; the tool surface we depend on (initialize/session.new/session.prompt/
session.update/session.request_permission) is the documented baseline.
