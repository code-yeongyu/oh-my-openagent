# Issue 5806 verification

Explicit ULW activation persists in per-hook, 256-session bounded state.
Existing guards, FIFO eviction, cleanup, and the pure model resolver remain
unchanged. Ordinary follow-ups add one durable synthetic activation marker
rather than copying the directive. On `session.compacted`, retained active
state records both the original source and `needsRestoration`. The production
`experimental.chat.system.transform` handler, wired by `plugin-interface.ts`,
selects guidance for the actual runtime model while restoration is pending,
and applies the current session's planner/non-OMO/subagent guards. Message
routing prefers the fallback-selected output model. A real `chat.message`
that appends full guidance clears the flag, then
normal compact markers resume. When restoration is pending and an image-only
turn has no real text part, a durable synthetic full-guidance part is written
instead; ordinary image follow-ups retain one compact marker. No path calls
`session.prompt`, and the ineffective compaction-context-only injection was
removed.

## Checks

Named early test logs below are committed captures with machine-local paths
redacted. [verification.txt](verification.txt) records the earlier Bun 1.4.0
recheck. The latest routing regression captures are [routing-red.txt](routing-red.txt)
and [routing-green.txt](routing-green.txt); the real harness capture is
[result.json](result.json).

- Current-agent guards and actual/fallback model routing failed first:
  20 pass / 4 fail, then 24 pass / 0 fail.
- Latest Bun 1.4.0 / Node 24.18.0 validation: 204 related tests passed;
  full typecheck, full build and real OpenCode replay passed. Host DB stayed
  at 8083 sessions. Exact output is in `routing-green.txt`.

- The original compaction-context tests (21 pass / 4 fail -> 25 / 0) did
  not prove guidance reached the automatic model call and were superseded.
- Failing first through the actual `plugin-interface.ts` system-transform
  route: 7 pass / 1 fail (`red-system-autoresume.txt`); the missing condition
  was persistent runtime guidance.
- `bun test --timeout 20000 packages/omo-opencode/src/plugin-interface.test.ts`:
  8 pass / 0 fail (`green-system-autoresume.txt`).
- Image-only restoration failed first at 12 pass / 1 fail
  (`red-image-restoration.txt`), then passed at 13 / 0
  (`green-image-restoration.txt`) by asserting source-byte equality for the
  durable synthetic part and the following marker-only image turn.
- `bun test --timeout 20000 packages/omo-opencode/src/hooks/keyword-detector packages/omo-opencode/src/plugin-interface.test.ts packages/omo-opencode/src/plugin/default-mode-priority.test.ts packages/omo-opencode/src/plugin/sisyphus-runtime-prompt-reconciler.test.ts packages/omo-opencode/src/index.compacting.test.ts packages/omo-opencode/src/plugin/chat-message.test.ts packages/omo-opencode/src/plugin/event.test.ts`: 201 pass / 0 fail across 15 files (`green-final-related-tests.txt`).
- Bun 1.3.14: local `bun run typecheck` exited 0
  (`typecheck-final-system-autoresume.txt`), and local `bun run build` exited 0 with
  `build: all steps completed` (`build-final-system-autoresume.txt`).
- Earlier source recheck with Bun 1.4.0 and Node 24.18.0: the same 201 tests,
  full typecheck, full build, and real OpenCode replay all passed.
  Host DB session counts remained 8083 before and after.
- Earlier remote CI failures matched dev run 34307575373, which
  reports the same `script/build-omob.test.ts` TS2305 missing
  `planRuntimePrune` / `selectPruneEntries` exports and the same Senpi stale
  output. Those unrelated files are untouched. See the PR checks for current CI.
- The language-server tool cannot inspect this sibling worktree; the complete
  compiler run above validates every changed TypeScript source file.

## Real harness capture

Real OpenCode 1.18.4 loaded a PluginModule whose registered system-transform
hook comes from the production `createPluginInterface()` path, alongside the
production keyword hook, autocontinue handler, event dispatcher, pure model
resolver, and common stop owner. The compaction model's scripted response is
deliberately `Done.`. Before `auto: true` compaction, the driver subscribes to
SSE, runtime-system guidance, autocontinue, and the exact next provider
request. The adapter writes raw guidance only inside disposable `/qa`; the
committed result is sanitized.

The exact result records `lossyCompactionSummary: true` and proves decoded
provider request 4 contains the runtime-produced system guidance:
`autoResumeGuidance.matchesRuntimeGuidance: true`, `bytes: 17539`, and SHA-256
`eb9497ebf95bd60daf71eb8ee051ae4c18b0661afd8b5fde4229b16bca12f7ba`.
`autocontinue.enabled` is true. Two HTTP turns prove activation and compact
retention; after the durable post-compaction turn, its follow-up uses a marker.
The native command stops continuation, and a subsequent message remains
ordinary. After reactivation, `deletion.routed` and `deletion.cleared` prove
dispatcher cleanup. The disposable ARM64 Docker container uses private
HOME/XDG roots and is removed after the run; host DB sessions remain equal.
Marker turns assert `originalTextPreserved: true` and `addedParts: 1`; no
prompt prose or prompt length is pinned.

## Reproduce and inspect

Prepare the `omo-qa` image using the repository's
[Docker QA setup](../../../.agents/skills/opencode-qa/references/docker-qa.md),
install repository dependencies, and select Bun 1.4.0 on PATH. From the root:

```sh
bash .omo/evidence/20260908-5806-ultrawork-followups/commands.sh
```

The committed [commands.sh](commands.sh), [adapter.ts](adapter.ts),
[build.ts](build.ts), and [run.mjs](run.mjs) are the actual replay files.
[result.json](result.json) is the exact structured capture.
[isolation.txt](isolation.txt) records the before/after
`SELECT count(*) FROM session` query against the host database resolved by
`opencode db path`; the replay asserts the counts are equal.

This covers the changed hook contract, not probabilistic model compliance or
full adapter bootstrap. The temporary bundle, raw prompts and unrelated logs
are omitted; no credentials or personal configuration were copied.
