# Evidence: fix #4856 (/connect makes agents disappear)

## WHAT WAS TESTED

1. Failing-first unit tests for the new `agent-registry-recovery` feature
   (`registry-snapshot.test.ts`, `stale-registry-recovery.test.ts`) plus the
   wired seams (`config-handler.test.ts` snapshot recording, `event.test.ts`
   regression).
   - Command: `bun test packages/omo-opencode/src/features/agent-registry-recovery/ packages/omo-opencode/src/plugin-handlers/config-handler.test.ts packages/omo-opencode/src/plugin/event.test.ts`
2. Scoped suites around both edited production files:
   - Command: `bun test packages/omo-opencode/src/plugin-handlers/ packages/omo-opencode/src/plugin/ packages/omo-opencode/src/features/agent-registry-recovery/`
3. Typecheck: `bunx tsgo --noEmit` (LSP daemon unreachable in worktrees; tsgo is authoritative per repo convention). Log: `typecheck.log`.
4. Live OpenCode mechanism probe (isolated XDG sandbox, stub plugin registering
   `probe-agent` via the config hook against the real installed opencode
   1.18.22 binary):
   - `GET /agent` listed plugin agent among build/plan/general/explore/... after hook fired.
   - `POST /instance/dispose` returned `true`; server stayed alive (HTTP 200);
     rebuilt instance re-ran the config hook (second entry in `hook.log`) and
     `probe-agent` was present again in `GET /agent`.
   - Artifacts: `live-probe-output.txt`, `hook.log`, `serve4.log`.

## WHAT WAS OBSERVED

- RED first: `red-run.log` shows 2 fail / module-not-found before implementation.
- GREEN after implementation: `green-run.log` (92 pass / 0 fail) and the wider
  scoped run (587 pass / 0 fail across 71 files).
- The live probe proves the recovery seam the fix relies on: disposing the
  instance makes OpenCode rebuild it, bootstrap awaits plugin config hooks
  before serving traffic, and plugin agents survive the rebuild.

## WHY IT IS ENOUGH

The root cause is upstream: OpenCode materializes its per-instance Agent
registry lazily from the shared config object and caches it for the instance
lifetime; when a query races OMO's async config-hook application (instance
recreation after `/connect`, startup race), the registry freezes without OMO
agents until restart (upstream anomalyco/opencode#30955, reproduced live:
hook fired at 09:30:17 while an early `/agent` query saw no plugin agents).
A plugin cannot unfreeze that cache directly; the only sanctioned rebuild path
is instance disposal, which the probe confirms restores plugin agents without
killing the server. The fix detects the frozen state after turns complete
(`session.idle`, no message in flight), verifies via `client.app.agents()`,
and disposes once per 30s cooldown. Remaining risk: if upstream changes the
dispose endpoint contract, recovery degrades to a logged no-op (fail-open).

## WHAT WAS OMITTED

- A full interactive TUI `/connect` drive with real provider credentials was
  not performed (no provider credentials in this environment; network
  restricted). The mechanism seam (config hook application + dispose/rebuild)
  was proven live with a stub plugin instead.
- Raw serve logs contain only local sandbox paths; nothing secret-bearing.
- No session-count isolation proof needed: the probe used a throwaway XDG
  sandbox under /tmp/opencode/probe; the real ~/.local/share/opencode DB was
  never touched.
