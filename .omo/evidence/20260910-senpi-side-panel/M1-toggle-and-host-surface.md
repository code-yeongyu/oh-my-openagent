# Evidence - senpi side panel, M1 (toggle + host surface)

Change: new opt-in `side-panel` component in `packages/omo-senpi`, new typed `side_panel` block in
`packages/omo-config-core`. Worktree `~/_code/omo-side-panel`, branch `feat/senpi-side-panel`,
base `826d819` (dev).

## WHAT WAS TESTED

1. **Config surface** - `bun test packages/omo-config-core/src/schema/side-panel.test.ts`: defaults,
   explicit overrides, `[senpi]` harness layer, profile layer, layer-schema default-freeness, strict
   rejection of unknown keys, width range rejection, poll-interval floor, and the resolver fallback.
2. **Host surface** - `bun test packages/omo-senpi/src/components/side-panel/host-surface.test.ts`
   against a fake renderer: mount decisions for a headless host and a non-tui mode, hstack assembly
   with the transcript entry first, unwrapped-render fallback, widget-block degradation when the
   layout seam or the root is missing, root restoration on dispose, refusal to clobber a foreign
   root, the narrow-terminal `visible` gate, and width re-resolution after a resize.
3. **Component gate** - `bun test packages/omo-senpi/src/components/side-panel/index.test.ts`:
   nothing mounts while disabled, the anchor widget installs when enabled, the CLI flag overrides the
   config in both directions, the flag registers without a default, a host without `ui` stays dark,
   shutdown clears the widget, and a second `session_start` does not mount twice.
4. **Pure rows** - `width.test.ts`, `sections/location.test.ts`, `body.test.ts`: percentage and
   column widths with clamps, transcript floor, home collapsing, head-elided truncation, and
   ANSI-aware padding.
5. **Registration order** - `session-start-ordering.test.ts` + `component-list.test.ts`.
6. **Bundle budget** - the component's real byte cost, isolated from the toolchain.
7. **Shipped artifact** - the component is present in the generated `plugin/extensions/omo.js`.

## WHAT WAS OBSERVED

- Suites 1-5 pass: 9 + 10 + 8 + 6 + 8 + 4 = 45 new tests, 0 fail. `tsgo --noEmit` clean for both
  `packages/omo-config-core/tsconfig.json` and `packages/omo-senpi/tsconfig.json`.
- Registration initially broke `session-start-ordering.test.ts`, which pins
  `onboarding === native-badge + 1`. Fixed by registering the panel after `init-deep-advisor`; both
  ordering suites green afterwards.
- Bundle budget, measured on one toolchain to separate the two contributions:

  | Build | Bytes | Note |
  |-------|-------|------|
  | committed at `826d819` (maintainer build, bun 1.4.x) | 1,089,658 | baseline in git |
  | rebuilt at HEAD **without** the component, local bun 1.3.13 | 1,100,671 | already over the 1,100,000 budget |
  | rebuilt **with** the component, local bun 1.3.13 | 1,104,769 | +4,098 vs the line above |
  | rebuilt **with** the component, pinned bun 1.4.2 (CI's version) | **1,094,685** | 5,315 bytes of headroom |

  The component costs **+4,098 bytes** minified. The older local bun inflates the same sources by
  **+11,013 bytes**, which is what trips the budget locally - not this change. No budget raise was
  made, and `assets/omo.schema.json` was regenerated with `bun run build:omo-schema`.
- Shipped artifact: `omo-side-panel`, `omo-side-panel-anchor`, `side-panel`, and both
  `Symbol.for("@earendil-works/pi-tui/...")` keys are all present in the built `omo.js`.
- Full senpi package suite on the pinned toolchain (bun 1.4.2):
  **3188 pass, 3 skip, 0 fail across 410 files, exit 0** (`/tmp/omo-with-changes-2.log`).
- The sanctioned gate, one run, end to end:
  `PATH=/tmp/bun142/bin:$PATH bun run test:senpi` -> **exit 0**
  (`build:senpi-plugin` + `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` + 3191 tests, 0 fail,
  + the evidence-dir suite 10 pass) - `/tmp/omo-gate-final.log`.
- One earlier run of the same suite reported a single failure in
  `packages/omo-senpi/src/components/memory/facts-payload-cap.test.ts`
  ("a backlog larger than the cap" - expected `["session-1","session-3"]`, received
  `["session-1","session-2"]`). It is a pre-existing flake in the memory suite, not a consequence of
  this change, established by four observations: the same test **passes** in a run at pristine HEAD
  with this change's registration reverted (`/tmp/omo-pristine-suite.log`), **passes** in the
  full run with the change applied (`/tmp/omo-with-changes-2.log`), **passes 3/3** when the file is
  run in isolation, and the failing selection is a queue-ordering assertion this change cannot
  reach. It is not listed in `docs/reference/known-issues.md`; reported rather than touched, since
  fixing another component's state leak is outside this scope.

## M2 ADDENDUM - bundle cost, and where it came from

The section builders, the row store, the shared formatters and the data adapters tripped the
`bundle-size` audit. The cause was not the new source but one import: a static
`@oh-my-opencode/senpi-task` in the component pulled the whole task module graph into the
extension **entry** bundle, where it does not otherwise live - the task engine ships in a separate
`omo-task.js` reached through the `#omo-task-runtime` alias, which the build keeps external.

| Build (pinned bun 1.4.2) | Bytes |
|--------------------------|-------|
| dev baseline without the component | 1,090,564 (9,436 under the old 1,100,000 budget) |
| with the component, static senpi-task import | 1,120,188 |
| with the component, read through `#omo-task-runtime` | **1,104,048** |

So the lazy-load recovered 16,140 bytes and the component's own cost is 13,484. The budget was then
raised 1,100,000 -> 1,150,000 with that measurement written into `bundle-size.test.ts`, per the
file's own rule: lazy-load or trim first, never raise to the failing value, and leave headroom
(~4%). No new third-party dependency is inlined - `bundle-purity` stays green.

## THE ONE RED TEST, DIAGNOSED (not this change, not fixed here)

`packages/omo-senpi/src/components/memory/facts-payload-cap.test.ts` -
"#given a backlog larger than the cap" - failed in two of five full runs and passed in the other
three, including a run at pristine HEAD with this change's registration reverted and 3/3 in
isolation. The failure is always the same shape:

```
expect(ledgers[0]?.queued.map((key) => key.conversationId).sort()).toEqual(["session-1", "session-3"])
  [ "session-1", - "session-3", + "session-2" ]
```

The fixture publishes three conversations, each carrying ~70% of the payload cap, so exactly one
bulk conversation fits per launch beside `session-1`. Which one that is depends on the order the
facts queue is walked, and the queue is read from a directory - so the pairing is not something the
implementation promises. The assertion pins one specific pair, which makes it order-dependent by
construction.

The invariant the test presumably means to guard is order-free: two ledgers, disjoint conversation
sets, each payload within `MAX_FACTS_PAYLOAD_BYTES`, and the union covering all three sessions.
Left untouched here because it belongs to another component and fixing it is outside this change's
scope; recorded so the red run is explained rather than ignored.

## WHY IT IS ENOUGH FOR M1

M1's contract is the toggle and the host surface, not the sections. Every branch of the surface
decision - column, widget block, dark - is asserted against a fake renderer, including the two
non-public seams' failure modes, so a host that changes shape degrades instead of breaking. The gate
is off by default and the disabled path is asserted to allocate nothing.

## WHAT IS NOT COVERED YET

- No live-session proof: this is unit-level only. A real `senpi` run with the panel enabled, at a
  wide and a narrow terminal, belongs to M4 and will be recorded under
  `.omo/evidence/omo-senpi-adapter/20260910-senpi-side-panel/` via the `senpi-qa` skill's driver.
- Mouse-click routing is deliberately absent: it depends on pi-tui's private SGR path, so it will
  ship as an enhancement with a keyboard route beside it (M3).
- The panel currently renders only the location row; the remaining sections land in M2.
