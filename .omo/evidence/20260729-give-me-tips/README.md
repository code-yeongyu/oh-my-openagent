# give-me-tips + fallback-architect visible tip — QA evidence (2026-07-29)

Branch: feat/fallback-architect-tip-and-give-me-tips (commits cdc906a6c, 09cb34f10, 6ef405986, 8f8f5264d)

## WHAT WAS TESTED

1. **Unit (RED→GREEN, bun:test)** — fallback-architect component: directive refusal-tip line,
   visible `omo-fallback-architect:tip` message (display:true) emitted only on refusal-driven
   fable5→fallback activation with the architect category active; `tip-message.ts` builder;
   skills-sync wiring for the new native skill. `red-unit-tests.txt` = failing BEFORE production
   code (right-reason assertion failures), `green-unit-tests.txt` = 63 pass / 0 fail after.
2. **fallback-architect-e2e (real senpi 2026.7.28-2 + two-model mock provider, isolated sandbox)**
   — `e2e-red-old-bundle.txt`: pre-change bundle FAILS only the new tip assertions
   (expectedTips 1 / observedTips 0 on refusal scenarios; negative scenarios pass).
   `e2e-green-new-bundle.txt`: rebuilt bundle, all 4 scenarios PASS (directive contains the
   refusal-tip content; transcript carries the display:true tip with fallback model id +
   give-me-tips; transient/architect-absent emit neither).
3. **Interactive TUI proof (tmux, real pty)** — `tip-tui-driver.mjs --mode omo-fallback`:
   live interactive senpi + refusal mock; the visible tip renders after refusal→fallback.
   `omo-fallback.txt` (plain pane), `omo-fallback.ans` (raw), `omo-fallback.grid.json` +
   `omo-fallback.html` (xterm-render triplet — assertions ran on the parsed cell grid),
   `omo-fallback-receipt.json` (tmux killed, sandbox removed, real auth.json untouched).

## WHAT WAS OBSERVED

- Refusal scenarios: hidden directive (with refusal-tip line) AND visible tip both in transcript;
  rendered on screen with the fallback model id (mock-weak) and the give-me-tips pointer.
- Negative scenarios (transient fallback, architect category absent): no directive, no tip.
- give-me-tips skill syncs via sync-skills.mjs into plugin/skills and is listed by install.mjs;
  skills-sync test updated (19→20 skills) and green.

## WHY IT IS ENOUGH

The component's activation path (detection + gate) is untouched and pinned by the e2e negative
scenarios; the additive tip is proven at the transcript seam (e2e) AND the rendered surface
(tmux + cell grid). Unit RED→GREEN covers the builder/gating logic. Remaining regression risk:
renderer styling only (cosmetic).

## ISOLATION NOTE

The e2e whole-dir digest guard reported contamination: a live operator session (and its two
implementer child sessions) was concurrently writing ~/.senpi/agent during the run.
`e2e-green-attribution.txt` lists every changed path — all are live-session transcripts/logs
(sessions/*.jsonl, settings.json, debug logs); auth.json is sha256-identical before/after.
The QA children wrote only to their /tmp sandbox agent dirs (removed; receipts in
omo-fallback-receipt.json).

## WHAT WAS OMITTED

No secrets captured: mock provider uses a file:// baseUrl + inline "mock" key; sandbox settings
contain no credentials; live-session transcript paths are listed by name only, contents untouched.

## POST-MERGE (origin/dev 0dbf644f9) RE-QA

After merging origin/dev (bundle conflict resolved by regeneration): bun test from root 412 pass / 0 fail
(bun-test-post-merge.txt); fallback-architect-e2e overall PASS incl. isolation guard
(e2e-green-post-merge.txt).
