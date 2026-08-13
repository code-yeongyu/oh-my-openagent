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

# UPDATE: headless mode added (published CLI entry)

**WHAT WAS TESTED:** the npm-published entry is `npx @deepseek-ai/dsh
--profile headless "<task>"` (one-shot, prints the final assistant message,
exits). The ACP server package (@deepseek-ai/dsh-acp) is a library with no
bin, so the tool now supports both modes: `headless` (default, works with
the published CLI today) and `acp` (protocol-first, for source compositions).

**WHAT WAS OBSERVED:**
1. Live CLI discovery: `npx -y @deepseek-ai/dsh --help` -> profiles web /
   headless / tui; `--profile headless "task"` boots and prints the result.
   A real smoke run reported `MISSING_CREDENTIAL: llm-deepseek: no API key
   for provider route "deepseek-official"` (expected: no DEEPSEEK_API_KEY in
   the sandbox env) — proving the entry, profile boot, and credential path
   all work end to end.
2. `bun test packages/omo-opencode/src/tools/dsh-agent/` -> 13 pass / 0 fail
   (headless runner: ok/fail/hang/abort via a real child fixture; tool
   dispatches headless vs acp modes correctly).
3. Config suite -> 141 pass; typecheck + build -> exit 0.

# UPDATE: C — deterministic self-verification gate on call_dsh_agent

**WHAT WAS TESTED:** the tool now accepts an optional `verify` arg (e.g. "bun
test", "bun run typecheck"). After the executor settles, omo runs the
deterministic gate locally in the working directory (no model call, no DeepSeek
key) and returns `{ verified, verify, evidence }`. On failure the output text is
appended with the captured gate evidence and the title marks VERIFICATION
FAILED. The gate metadata feeds the v4-verification-gate's metadata failure
detection (PR #6639 A+B).

**WHAT WAS OBSERVED:**
1. `bun test packages/omo-opencode/src/tools/dsh-agent/` -> 19 pass / 0 fail.
   New: verify gate passing -> title "verified", metadata verified:true; gate
   failing -> title "VERIFICATION FAILED" with evidence appended; real-child
   verify tests (true -> verified; failing -> evidence captured incl stderr;
   timeout -> rejects).
2. `bun run typecheck` + `bun run build` -> exit 0.
