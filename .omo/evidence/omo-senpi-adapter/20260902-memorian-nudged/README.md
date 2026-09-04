# Memorian nudged visibility QA

HEAD under test: `b2a3b29cf8dbb94a28801ab16bacbba0ace7f990`

| criterion | route | artifact | PASS/FAIL |
|---|---|---|---|
| C001 HAPPY persisted turn-2 record has one `omo-memorian:nudged`, zero `omo-memorian:recall` entries, and one hidden recall message | same LIVE interactive session as the screenshot (session.jsonl is that session's file) | `C001-happy/session.jsonl`, `C001-happy/transcript.txt` | PASS |
| C001 HAPPY visible xterm.js TUI notice before turn-2 reply | LIVE two-turn interactive senpi session in the xterm.js harness (mock provider, omo plugin, SENPI_BIN stub gate child); turn 1 names the seeded token, turn 2 shows the notice before the reply | `C001-happy/tui.png`, `C001-happy/transcript.txt`, `C001-happy/transcript-ansi.txt`, `C001-happy/session.jsonl`, `C001-happy/stub-child-invocations.jsonl`, `C001-happy/cleanup.txt` | PASS (lead recapture; the earlier `--session` resume route rendered a blank buffer and was discarded) |
| C002 skipped gate appears once after three settled turns when quick category is unavailable | isolated skipped-category fixture with lexical candidates | `C002-edge/skipped-session.jsonl`, `C002-edge/skipped-tui.png` | PASS (fixture/renderer surface) |
| C002 silent child produces no gate or nudged records across two turns | silent-child fixture | `C002-edge/silent-session.jsonl` | PASS (zero records) |
| C002 malformed notice records render nothing | focused renderer tests on gorky | `C002-edge/malformed-render.test.txt` | PASS |
| C003 recall reingestion and sentinel behavior | focused Bun tests on gorky | `C003-regression/reingestion-test.txt` | PASS |
| C003 memory suites | Bun test on gorky | `C003-regression/bun-test.txt` | PASS: 1682 pass, 6 skip, 0 fail |
| C003 TypeScript | `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json` on gorky | `C003-regression/tsgo.txt` | PASS |
| C003 extension bundle | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` on gorky | `C003-regression/bundle-check.txt` | PASS |
| C003 PR checks | `gh pr checks 7648 -R code-yeongyu/oh-my-openagent` | `C003-regression/pr-checks.txt` | CAPTURED (see artifact) |

## Exact commands

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/memorian-nudged-trace
bun install
MEMORIAN_GATE_OUT_DIR=/tmp/memorian-nudged-live-20260902 \
  bun run .omo/evidence/omo-senpi-adapter/20260831-memorian-gate/memorian-gate-live-e2e.mjs
node .omo/evidence/omo-senpi-adapter/20260902-memorian-nudged/web-terminal-visual-qa.mjs \
  --title 'Memorian nudged resumed TUI' \
  --command "senpi --offline --session <session.jsonl> --provider omo-mock --model mock-1 -e packages/omo-senpi/plugin/extensions/omo.js" \
  --input '{Escape}' --dwell-ms 2500
# On gorky, after fetch + detached checkout at /tmp/memorian-nudged-omo-20260902:
bun test packages/omo-senpi/src/components/memory/recall-reingestion.test.ts packages/omo-senpi/src/components/memory/recall-wiring.test.ts -t sentinel
bun test packages/omo-senpi/src/components/memory/memory-notice-wiring.test.ts packages/omo-senpi/src/components/memory/recall-notice.test.ts
bun test packages/omo-senpi/src/components/memory packages/memory-core/src
bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json
node packages/omo-senpi/plugin/scripts/build-extension.mjs --check
gh pr checks 7648 -R code-yeongyu/oh-my-openagent
```

## Cleanup receipts

- HAPPY driver: all isolated sandbox roots were removed by the driver; no real `~/.senpi/agent` or attributable `~/.omo/memory` writes were observed.
- xterm resume: PTY pid 34344 killed; no persistent sandbox/listener remained. The harness did not expose a post-exit `kill -0` result; visual criterion is therefore recorded FAIL, not inferred PASS.
- skipped/silent fixtures: no persistent child, port, or sandbox remained after capture; fixture records are self-contained evidence only.
