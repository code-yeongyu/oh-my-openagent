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
| `reflection-run-id.ts` | Mints reflection run ids one past the highest id still on disk (completion records, run/session dirs, epoch-prefixed worktrees, live reservation state), mirroring the facts lane's attempt sequence. A bare per-process counter restarted at 1 each launch and re-minted retired ids, whose durable completion records then collided (`Reflection completion record mismatch`) and wedged launch, reconcile, and finalization permanently. The reservation store awaits this factory INSIDE the scheduler lock so concurrent reservations cannot double-mint. |
| `prompt.ts` | Per-run compiled-memory injection via `before_agent_start`; composes the incoming prompt, sentinel-delimited block, (template,HEAD) cache. |
| `tools.ts` | `memory` + `memory_apply_patch` ToolDefinitions over the core engines under the `memory-write` cross-process lock; execute-time activation gating. |
| `journal-wiring.ts` | `agent_settled` branch-delta scan + `session_start` crash reconcile into per-session transcript journals (v3_assistant_steps cursor). |
| `trigger-wiring.ts` | Trigger evaluation on successful settle only; compaction flag consumed once; manual entrypoint for `/reflect`. |
| `worker/` | Detached `senpi -p` reflection/dream/facts child execution: run supervisor (absolute hard deadline, process-group kill; win32 `taskkill /T /F`), durable run ledger + sentinels, crash reconciliation, completion records/delivery, model resolution ladder, READ-ONLY health. See `worker/AGENTS.md`. |
| `nudge-wiring.ts` | Save-nudge accounting: counts accepted user turns since the last memory write (commit-trailer provenance), surfaces a nudge line in the compiled metadata block at `nudge.every_user_turns`. |
| `facts-wiring.ts` / `facts-runner.ts` | Durable facts queue (settle-time enqueue, crash reconcile) + quick-pinned background extractor child; the parent applies the whole batch under the `memory-write` lock, the child never touches git. |
| `facts-terminal-writes.ts` / `facts-run-finalize.ts` | Terminal outcome for a claimed run. Every failure path records the run's queued endpoints in the failure-streak ledger BEFORE writing `final.json`/`abandoned.json` (idempotent per `failureId` = runId, so a crash in that window replays safely); `committed`/`no_facts` clear those records after `markConsumed`. |
| `facts-run-storage.ts` / `facts-run-prune.ts` / `facts-run-cleanup.ts` | Run-dir lifecycle. Reservation (scan + mkdir + ledger) and retention pruning share `facts-runs.lock`, so pruning can never free a `facts-<digest>-<attempt>` name a reservation is probing; the attempt sequence starts above the highest name ever seen (tombstones included) and stays monotonic. Pruning keeps the newest terminal run ALWAYS, plus `keepLast=20` under a 128MiB total, skips any run whose finalize lock is busy, renames to `.prune-*` under both locks and `rm -rf`s only after releasing them. Session-start maintenance clears leftover payloads and `.prune-*` tombstones. |
| `facts-launch-selection.ts` | Launch-time read of `failures.json` (once per attempt) feeding memory-core's `selectLaunchable`. Fail-closed: an unreadable ledger warns and refuses the launch instead of degrading to "no failures". Parked/backoff endpoints are dropped, and a dropped entry blocks its own conversation's later entries; no run dir is reserved when the selection is empty. |
| `dream-selector.ts` | Dream conversation auto-selector: unreflected-volume gate, caps at `dream.auto_select_max` conversations / `dream.auto_select_max_chars` UTF-8 bytes. |
| `skills-usage.ts` | Per-skill read-count ledger consumed by the dream skill-audit phase. |
| `soul-notice.ts` | Soul-edit notice entry type + renderer: commits touching `system/persona.md` or `system/identity.md` emit a non-model-facing `appendEntry` notice, gated by `soul.edit_notice`. |
| `memory-notice-wiring.ts` | Shared commit-notice consumer. Reads each MCP tool receipt EXACTLY ONCE per `tool_result` (receipts are read-and-delete, so a second read finds nothing) and fans that one read out to the soul notice (`soul.edit_notice`) and the `omo-memory:write-updated` entry (`write_notice.enabled`), which reuses the direct surface's renderer. The direct surface emits no write entry: its `renderResult` already draws that row. |
| `shutdown-drain.ts` | Session-shutdown journal drain under a hard budget. |
| `sandbox.ts` | Seatbelt/bwrap sandbox transform for reflection children (`required|auto|off`, default `auto`). |
| `commands/` | Thirteen slash commands (`MEMORY_COMMAND_NAMES`: `/memory`, `/memfs`, `/remember`, `/init`, `/doctor`, `/recompile`, `/memory-repository`, `/sleeptime`, `/reflect`, `/dream`, `/search`, `/people`, `/facts`); read-only output never enters model context. `/facts retry [--conversation <id>]` is the ONLY unpark path; it never touches queue files or either watermark. See `commands/AGENTS.md`. |
| `palace/` | Self-contained HTML memory viewer. See `palace/AGENTS.md`. |
| `guard.ts` | Soft cross-identity guard via `tool_call` (file tools only; bash advisory-only). |
| `policy-guard.ts` | Hard guard: registers a filesystem policy when the host exposes `registerFilesystemPolicy` (senpi >= feat/extension-fs-policy), soft guard otherwise. |
| `skills-scope.ts` | Agent memfs `skills/` exposure via `resources_discover`. |
| `status.ts` | Footer status + committed-only token advisory at `compile_warn_tokens`. |
| `status-live.ts` | Generic footer animation: braille reflecting spinner, fingerprint-gated segment refresh, injectable timers. |
| `status-live-wiring.ts` | Binds the footer animation to memory state: session-to-identity resolution, git-backed fingerprint, segment line via the shared status.ts formatter. |
| `status-active-runs.ts` | Per-identity registry of in-flight reflection runs keyed by run id; drives footer animation and supplies run details to the rpc bridge. |
| `memory-rpc-bridge.ts` | RPC surface: fingerprint-deduped `omo.memory.updated` snapshot push plus `omo.memory.status` pull; every rpc touch is guarded, so a host without `pi.rpc` is a silent no-op. |
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
6. **No `/reflect --auto` selector subagent, no external-transcript staging, no `letta dream --to` doc maintenance.** Manual reflection takes `--recent N` / `--conversation <ids>` / free-text focus. The dream pass (below) carries its own conversation auto-selector, but that is an omo extension riding the reservation machine, not a port of letta's slash surfaces.
7. **No recall subagent or conversation-bootstrap injection.** `/search` is the recall surface (letta's local path already disables AI description generation, C46).
8. **No onboarding tutorial personality / welcome hints.** Default seeds (`system/persona.md`, `system/human.md`) are the only first-run content.
9. **Reflection sandbox default is `auto`**, not letta's fail-closed `required` (C33): default-on reflection must not break hosts without seatbelt/bwrap. `memory.reflection.sandbox: "required"` restores letta semantics.
10. **`memory_description`/`limit` frontmatter tolerance matches letta; block-scalar descriptions are rejected** (letta's cut-prefix accepted `>`; that acceptance is treated as a bug). Frontmatter additionally parses and preserves typed `kind` + `aliases` for people cards, an omo extension letta has no analog for.
11. **str_replace replaces the FIRST occurrence** (letta actual behavior, C21); the advisory's exactly-one-match proposal was rejected for parity.
12. **Message store = senpi session JSONL** (letta's LocalStore JSONL was not ported; the engine reads senpi's native format).
13. **`reflection.trigger.step_count` stays at letta's 25** (schema default); memory v2 changed the trigger machinery and added the dream kind, not the reflection cadence.

## Extensions beyond parity

Active learning is ON by default (`memory.enabled: true` plus every sub-feature below defaulting on). These are omo-only additions, not parity claims against letta-code:

- **Save nudge** (`memory.nudge`): after `every_user_turns` (default 10) accepted user turns without a memory write, a nudge line joins the compiled metadata block. Write detection keys on commit trailers (`Omo-Writer`/`Omo-Session`/`Omo-Turn`), never on git author identity.
- **Facts extractor** (`memory.facts`): settle-time queue entries debounce (`debounce_settles`, default 4) into a detached `senpi -p` child that emits `extraction.jsonl` only; the parent applies the batch as one commit with a `Generated-By: facts-extractor` trailer.
- **Dream pass** (`memory.dream`): a distinct reservation trigger kind (`"dream"` with `origin: manual|idle|shutdown|pressure`) running a consolidation + skill-audit + people persona through the same worker pipeline. Idle/shutdown use the conversation auto-selector capped by `auto_select_max` / `auto_select_max_chars`; pressure compacts the memory tree without a transcript-volume floor.
- **People cards** (`memory.people`): typed card + observation formats in memory-core (`kind`/`aliases` frontmatter, per-card `max_entries`/`max_entry_chars` limits), plus a relationship graph view in the memory palace.
- **Soul v2** (`memory.soul`): `system/identity.md` joins `<self>` alongside the persona, and committed soul edits surface a visible non-model-facing notice when `edit_notice` is true.
- **MCP search surface** (`memory.tool_exposure: "search"`): opts the memory tools out of direct registration and into an extension-declared stdio MCP server behind senpi's `tool_search` catalog. Default stays `"direct"` because a failed MCP server would remove memory entirely.
- **Run supervisor**: every reflection/dream/facts child is spawned through `memory-run-supervisor.mjs`, which owns the run identity handshake and the `outcome.json` sentinel. On win32, process groups and POSIX signals are unavailable: the child spawns non-detached, graceful `child.kill()` fires at the SIGTERM instant and `taskkill /pid <pid> /T /F` at the SIGKILL instant, process-start identity is always null so reconciliation of an abruptly dead supervisor resolves through the non-destructive UNKNOWN path to `abandoned.json`, and the bootstrap self-enforces the same absolute deadline.

## Deliberate constants (not knobs)

- **Facts extractor category is pinned `"quick"`** (`facts-runner.ts` `QUICK_CATEGORY`); resolution failure logs a warning and skips the run, never falls back to another category. The schema comment in `omo-config-core/src/schema/memory.ts` records the same decision.
- **Shutdown drain budget is 1500 ms** (`shutdown-drain.ts` `SESSION_SHUTDOWN_DRAIN_BUDGET_MS`): senpi blocks shutdown on the drain handler, so the budget is a pinned constant rather than configuration.
