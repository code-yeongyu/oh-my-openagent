# memory component

Letta-Code-style persistent agent memory for omo-senpi, backed by `@oh-my-opencode/memory-core` (harness-neutral; zero Senpi imports). Parity target: letta-code@a75f4d93e's local-capable matrix, executed per `.omo/plans/letta-memory-parity-port.md` with the research corpus at `.omo/ulw-research/20260809-224128/`.

## Attribution

The memory architecture - the git-backed memory filesystem, the memory tool semantics, and background reflection - is inspired by [letta-code](https://github.com/letta-ai/letta-code), which is Apache-2.0 licensed (Copyright 2025, Letta authors). This component is an independent reimplementation written against the observable behavior of letta-code@a75f4d93e; no letta-code source was copied. "Letta" and "Letta Code" are trademarks of Letta, Inc., referenced only to describe origin.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Component factory: capability checks, config latch, session binding (`senpi-memory.session-binding`), fail-closed resume conflicts, supervisor refcount, shutdown cleanup. |
| `wiring.ts` | Registration surface: prompt handler, journal routing, tools, guard, skills scope, commands, trigger wiring, completion renderer/consumption, policy registration, status refresh. |
| `identity-runtime.ts` | Per-identity reflection assembly: reservation store (trigger engine), worker runner, lazy OS-sandbox transform. |
| `prompt.ts` | Per-run compiled-memory injection via `before_agent_start`; composes the incoming prompt, sentinel-delimited block, (template,HEAD) cache. |
| `tools.ts` | `memory` + `memory_apply_patch` ToolDefinitions over the core engines under the `memory-write` cross-process lock; execute-time activation gating. |
| `journal-wiring.ts` | `agent_settled` branch-delta scan + `session_start` crash reconcile into per-session transcript journals (v3_assistant_steps cursor). |
| `trigger-wiring.ts` | Trigger evaluation on successful settle only; compaction flag consumed once; manual entrypoint for `/reflect`. |
| `worker/` | Detached `senpi -p` reflection child: quick-category model resolution, worktree isolation, hard deadline (SIGTERM->SIGKILL process group), completion validation, auto/explicit merge, durable completion records (`runtime/reflection/completions/`). |
| `sandbox.ts` | Seatbelt/bwrap sandbox transform for reflection children (`required|auto|off`, default `auto`). |
| `commands/` | Ten slash commands; read-only output never enters model context. |
| `palace/` | Self-contained HTML memory viewer (0600/0700, machine-gated inline-JSON assertions). |
| `guard.ts` | Soft cross-identity guard via `tool_call` (file tools only; bash advisory-only). |
| `policy-guard.ts` | Hard guard: registers a filesystem policy when the host exposes `registerFilesystemPolicy` (senpi >= feat/extension-fs-policy), soft guard otherwise. |
| `skills-scope.ts` | Agent memfs `skills/` exposure via `resources_discover`. |
| `status.ts` | Footer status + committed-only token advisory at `compile_warn_tokens`. |
| `binding.ts` / `bindings/` | Binding entry record + renderer. |
| `capabilities.ts` | `appendEntry`/`registerEntryRenderer` capability narrowing (`MemoryExtensionAPI`). |
| `supervisor.ts` | Ref-counted module supervisor placeholder. |

## Declared divergences from letta-code@a75f4d93e

Every row is intentional; each was weighed against the research corpus (claim-graph.md).

1. **Local-capable matrix only.** Letta Cloud rows are out: org shared repositories, server block identity/sharing, server secrets, `.af` import/export, server-side tool management, semantic/vector search endpoints, per-user cloud metadata, server context accounting. The push-only git mirror (`/memory-repository`) is the cloud-free sync story.
2. **No mods-in-memory.** `mods/` executables in the memory repo are not loaded (trusted code in memory expands attack surface). The repo layout tolerates a `mods/` dir but nothing executes it.
3. **No reflection arena, no channels.** The A/B arena experiment and Discord/Telegram `/reflection` routing have no omo analog.
4. **Local search is text-only by design**, matching letta's local backend (its `vector|hybrid` modes degrade to FTS-lite locally). Senpi sessions are scanned via the senpi JSONL provider; archived-sidecar and internal-session exclusions apply, `--include-hidden` overrides.
5. **No mid-conversation `<memory_update>` one-shot.** Letta special-cases `anthropic/claude-opus-4-8` (C15/C27); omo recompiles per run for every model (generalized, per-run `before_agent_start` re-check of HEAD).
6. **No `/reflect --auto` selector subagent, no external-transcript staging, no `letta dream --to` doc maintenance.** Manual reflection takes `--recent N` / `--conversation <ids>` / free-text focus.
7. **No recall subagent or conversation-bootstrap injection.** `/search` is the recall surface (letta's local path already disables AI description generation, C46).
8. **No onboarding tutorial personality / welcome hints.** Default seeds (`system/persona.md`, `system/human.md`) are the only first-run content.
9. **Reflection sandbox default is `auto`**, not letta's fail-closed `required` (C33): default-on reflection must not break hosts without seatbelt/bwrap. `memory.reflection.sandbox: "required"` restores letta semantics.
10. **`memory_description`/`limit` frontmatter tolerance matches letta; block-scalar descriptions are rejected** (letta's cut-prefix accepted `>` — that acceptance is treated as a bug).
11. **str_replace replaces the FIRST occurrence** (letta actual behavior, C21) — the advisory's exactly-one-match proposal was rejected for parity.
12. **Message store = senpi session JSONL** (letta's LocalStore JSONL was not ported; the engine reads senpi's native format).
