## 6. Parity table

Direction: **SDK ⊇ CLI and SDK ⊇ tools.** Every row is a leaf capability with its inputs and has an SDK call.

- **SDK today**: **yes** (the root or a facade answers it, with these inputs honoured, at the pinned commit), **partial** (one of the entries answers part of it; the gap is named), **no** (a defect under the rule).
- **Adapter**: for a CLI or tool cell that is empty, either **planned** with the slice that adds it, or **omitted** with the reason it is intentionally narrower. "Not built yet" is never a reason.
- **Slice**: the slice of section 8 that builds the row's SDK call. Every row that counts toward closure has one. A `reserved` name (6.7) is not such a row.

### 6.1 Threads: reading

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.1}}

The `state` filter, as a fixed table. The thread vocabulary is `opening`, `running`, `idle`, `inactive`, `archived` (`T/contracts/params.ts:20-44`); the remote vocabulary is `running`, `idle`, `ended` with a separate `archived` flag on each row (`R/types.ts:87-104`).

| Filter value | Rows on this device it keeps | Rows on other devices it keeps |
|---|---|---|
| `opening` | Rows a local engine handoff lists as opening | None: the remote row has no such state |
| `running` | Running | State `running`, not archived |
| `idle` | Idle | State `idle`, not archived |
| `inactive` | No engine holds it, not archived | State `ended`, not archived |
| `archived` | Archived | `archived: true`, whatever the state |
| none given | Every state but `archived` | Every row with `archived: false` |
| several | The union | The union |

`ended` is not a root input. It is the alias `omo remote sessions --state ended`, which its descriptor maps to `state: ["inactive"]` with `device` scoped to other devices; the alias's rows keep their present shape, `state: "ended"` included, through its render projection. Before the alias converges, a golden test pins its present output; where this table and that output differ, the alias keeps its output and the table is corrected.

### 6.2 Threads: writing and control

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.2}}

### 6.3 Devices

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.3}}

`devices.enroll` (#14365) is outside this program; the name is reserved.

### 6.4 Account

Both editions register `login`, `logout` and `whoami` over the same core (`C/cli-program.ts:236-238`, `C/service-auth/commands.ts:234-315`), each with its own hooks. Each edition has its own descriptor rows over the calls below and keeps its present admission, help and refusal outcomes, including the hidden routes that exist while accounts are closed.

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.4}}

### 6.5 Device service (remote switches)

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.5}}

### 6.6 Sync

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.6}}

### 6.7 Config, daemon and hosts, diagnostics, install

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.7}}

### 6.8 Engine commands forwarded by the launcher

The launcher forwards these to the pinned engine unchanged. Their core is the engine's. Under the rule each still needs an SDK call. The engine exports a typed function per leaf operation, with no process exit and no printing, and its own CLI calls the same function; the omo SDK re-exports it. The SDK does not start the engine CLI as a child for them. An exported function takes no principal: the principal is fixed on the omo root (4.3), which enforces the security design's refusals before it calls the engine. An exported function never reads terminal state either: where an operation needs the project-trust decision and `trust` is omitted, it answers a typed refusal that names the input and never defaults to trust, and the CLI adapter owns the prompt. Forwarding an argv today proves nothing about an importable equivalent, so these functions and their ownership of lifecycle and output are settled in the engine first (slice E1a). `trust` below is the project-trust choice of `--approve` and `--no-approve`. Each row has two phases: the Slice column names the engine slice that exports the function, and the row becomes a call on the omo root, with its descriptor migrated and its unresolved entry cleared, only in E1c.

Where an operation has inputs that the security design gates (the endpoint selector, a key root, a presenter channel, the launch `setup`), there is still one implementation: one internal core function that takes every input, which the engine's CLI command calls. Slice E1a exports that function with the gated inputs left at their defaults, and slice E1a-s adds them to the exported signature. The exported function is never a second body. The exported command metadata lists the gated flags from the start, each marked as an input that E1a-s adds, so the registry sees them as recorded gaps and not as unmapped flags.

| Capability and SDK inputs | CLI today | Tool | SDK today | Adapter | Slice |
|---|---|---|---|---|---|
{{rows 6.8}}

### 6.9 Launching an engine process

`omo [flags] [prompt]` starts an engine process. That is a different capability from opening a thread on a host (`threads.create`), and it is where a fork is supported today: the terminal process forks a session (`E/main.ts:438-445`), while a host open refuses `fork_from`. The launch is its own set of SDK operations, one per mode. Each takes the parts of one `LaunchOptions` type that its mode admits and refuses the rest with the parser's own refusals; the engine exports the type as its `Args` schema (slice E1a-s). The classification below is from the engine's parser and help text (`E/cli/args.ts`).

`LaunchOptions`:

| Part | Fields | Flags |
|---|---|---|
| `session` | One of `{ continue: true }`, `{ path }`, `{ id }` (created if missing), `{ fork }` (never with the others), `{ rebind }`, `{ ephemeral: true }`; plus `dir?`, `spawned_by?: { parentSessionId, rootSessionId, taskId }`, `name?` | `--continue`, `--session <path>`, `--session-id <id>`, `--fork <path\|id>`, `--rebind <path\|id>`, `--no-session`, `--session-dir <dir>`, `--spawned-by <json>`, `--name`. `--resume` is a picker: a renderer over `threads.list` that fills `session.path` |
| `setup` | `model?`, `provider?`, `model_patterns?`, `reasoning?`, `system_prompt?`, `append_system_prompt?`, `tools?: { allow?, deny?, none?, no_builtin? }`, `extensions?: { paths?, none? }`, `skills?: { names?, none? }`, `prompt_templates?: { paths?, none? }`, `themes?: { paths?, none?, use? }`, `context_files?: boolean`, `project_trust?: boolean`, `offline?`, `session_runtime?: "in-process" \| "worker"`, `tool_runtime?: "in-process" \| "child"`, `auto_title?`, `extension_flags?` | `--model`, `--provider`, `--models`, `--thinking`, `--system-prompt`, `--append-system-prompt`, `--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--extension`, `--no-extensions`, `--skill`, `--no-skills`, `--prompt-template`, `--no-prompt-templates`, `--theme`, `--no-themes`, `--use-theme`, `--no-context-files`, `--approve`, `--no-approve`, `--offline`, `--session-runtime`, `--tool-runtime`, `--auto-title-sessions`; a flag an extension registers (the engine's help names `--plan`) fills `extension_flags` and is discovered from a test engine session |
| `input` | `messages?: string[]` in the order given, `files?: string[]`, `stdin?: boolean`. Several messages and files are kept as given; the parser's selection among them and its refusals are the contract | Positional arguments, each `@<file>` argument, `-` to read stdin, everything after `--` (`E/cli/args.ts:155-160, 374-400`); `--print [message]` adds its message to the list (`:268-273`) |
| `presenter` | `{ bootstrap_fd: 4, enforcement?: boolean }`. Its contract is the security design's; until that approval these two inputs are a recorded gap, not a flag classified away | `--mcp-presenter-fd 4`, `--mcp-presenter-enforcement` (`E/cli/args.ts:347-351`) |
| `gated` | `{ grok_neo?: boolean }`: an input the engine's parser accepts only while its feature gate is on. With the gate off the same text is not this input and falls to the unknown-flag path, as today (`E/cli/args.ts:339-340`). The row exists now, with that availability rule; each later gated input needs its own | `--grok-neo` |
| A credential | A provider API key for the run. The registry records it as an `api_key` input of each launch operation, a recorded gap that only slice E1a-s can clear; its SDK name and its carrier are fixed by S0 | `--api-key` |

Operations:

| Capability | CLI today | Outcome | Tool | SDK today | Slice |
|---|---|---|---|---|---|
{{rows 6.9}}

A launch function starts the engine entry as a new process: that is what a launch is, and the rule of 6.8 against starting the CLI as a child is for the forwarded commands. Its argv is derived from the exported command metadata run backwards, with a round-trip test per field, and the parser's refusals run in-process before anything is started. The launch function does not choose a session id for the caller: an id no project session has makes the engine print a warning line, which would change what a person sees. The credential input is a readable handle, delivered to the started process on a private inherited descriptor, never in its argv or its environment (the security design's row for a provider key at launch).

Which `setup` fields each mode admits, beyond the refusals named in its row, is read from the engine's exported schema in slice E1a-s. A field a mode's parser accepts and its operation lacks fails the flag check of section 7.1.

### 6.10 Rows that are not capabilities

- **Internal**: entries the binary dispatches for its own processes (`__kill-guard`, `__device-service-bootstrap` from #14890, `remote enable --after-login`, the engine's `--omo-local-update-worker`, the compiled binary's `--internal-rpc-host-supervisor` at `N/supervisor-fast-path.ts:10`, and the compiled binary's `loro-smoke` at `N/compile-entry.ts:180-183`, a self-check that the bundled sync runtime initializes and reproduces its committed encodings). Each is registered as `internal` with the capability it serves (`deviceService.bootstrap`, `install.update`, `daemon.ensure` for the supervisor flag, the launch operations of 6.9 for `__kill-guard`, which is the judge a running session's shell shims ask before a kill and is anchored on the interactive launch row, and a finding of `diagnostics.run` for the self-check), so a hidden verb cannot bypass the check by being hidden.
- **Retired**: a verb that only answers where it went (`omo app-server`, the native `omo ulw-loop`), registered with the call that replaced it.
- **Render**: `--help`, `-h`, `--json`, `--verbose`, `--no-timestamp` on any verb.

### 6.11 The OpenCode-edition binary

`C/` ships a different binary (`oh-my-opencode`, `oh-my-openagent`). The scope decision on #14943 (2026-11-25, made for the owner under his standing order, his to override) is **both editions**: everything a CLI can do works through the SDK, with no carve-out by binary.

- A verb that shares a domain core with the native edition goes through the same core and the same SDK call. The OpenCode-edition CLI becomes one more adapter; it gets no second implementation.
- A verb that exists only in that edition gets an SDK call of its own.
- Order: the native-edition slices first, then the OpenCode-edition slices. #14943 closes only when both editions are at zero gaps.

Its routes are Commander registrations; the registry reads them from the program object (commands, aliases, options, hidden routes, root options), not from this table.

| Capability and SDK inputs | CLI (OpenCode edition) | SDK today | Adapter | Slice |
|---|---|---|---|---|
{{rows 6.11}}

`ulw-loop [args...]` reaches the component's own dispatch (`packages/omo-codex/plugin/components/ulw-loop/src/cli.ts:8-44`, `cli-commands.ts:39-101`). That component already runs every sub-command through its own SDK (`cli-subcommands.ts:204`), whose manifest names one method per operation (`src/sdk/manifest.ts`). What is missing is the root: the OpenCode binary starts a child process, and `toolkit` on the root does not reach this component. Each leaf, with its flags as the component's usage gives them (`cli-output.ts:4-20`); `--json` on any of them is rendering.

Every state sub-command runs against exactly one loop session, and that shared input has one typed binding on the root: `toolkit.forSession({ cwd, session_id? })` answers the operations bound to that session, and the rows below are methods of what it answers. The core resolves the session, not the adapter: an explicit `session_id` (the `--session-id` flag; present but empty is refused `ULW_LOOP_SESSION_ID_REQUIRED`), else the first of the session environment keys the component reads, else the refusal `ULW_LOOP_SESSION_SCOPE_REQUIRED` with the existing session ids in its details. The unscoped root is never used implicitly (`cli-commands.ts:110-131`, `cli-subcommands.ts:204-216`). An adapter passes the flag's value or nothing and never reads the environment or builds a loop context itself. Which principal may bind which session is a row of the security design; this design proposes no new authority there: a person or a script names the session as the flag does today, and a session is bound to its own. `help` needs no session:

| Sub-command and flags | Root call | SDK today |
|---|---|---|
{{rows 6.11-loop}}

The argument object of each method is the manifest's `args` for that operation, and the registry takes it from the manifest, not from this table. Each of the ten operations is an entry of P0's baseline until OC2 wires the root to this component, and the command keeps its present behaviour until then. P0 registers the manifest's argument shapes and checks them against the descriptors, and the baseline of this delegated registry includes the two shared-input scenarios: the brief's four sources with their order and the empty refusal, and the session binding with its flag, environment and two refusals.

The OpenCode-edition binary has no thread tools of its own in this table: its agent-facing tools are that edition's plugin tools, outside the three surfaces this issue names.

