# BTW side conversation QA

## What was tested

### Source and regression checks

- Focused BTW and TUI tests:

  ```sh
  bun test \
    ./packages/omo-opencode/src/plugin/messages-transform.test.ts \
    ./packages/omo-opencode/src/features/btw-side/context-injector.test.ts \
    ./packages/omo-opencode/src/features/btw-side/tui-controller.test.ts \
    ./packages/omo-opencode/src/features/btw-side/tui-wiring.test.ts \
    ./packages/omo-opencode/src/tui.test.ts
  ```

- OpenCode package typecheck:

  ```sh
  bun run --cwd packages/omo-opencode typecheck
  ```

- Repository typecheck:

  ```sh
  bun run typecheck
  ```

- Repository-pinned Bun 1.3.12 build:

  ```sh
  bun run build
  ```

- OpenCode QA helper checks:

  ```sh
  .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
  .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test
  node script/qa/web-terminal-visual-qa.mjs --self-test
  ```

### Real surface

The real OpenCode 1.18.18 TUI was launched with:

- isolated XDG data, config, cache, and state directories;
- the worktree-built `dist/index.js` and `dist/tui.js`;
- a local OpenAI Responses-compatible mock server on `127.0.0.1`;
- no real provider request;
- HTTP control for deterministic prompt insertion;
- a physical Enter key for the real TUI keymap path;
- an enhanced `Ctrl+/` terminal sequence for parent-side switching;
- a physical `Ctrl+C` for side closure.

The exercised flow was:

1. Submit a parent prompt containing `ALPHA-CONTEXT-42`.
2. Keep the parent model request open so the parent remains busy.
3. Filter the slash palette with `/btw` and observe the command as its first
   result.
4. Enter `/btw first side question`.
5. Press Enter through the real TUI.
6. Observe a new metadata-marked temporary session.
7. Observe the side model request contains both the parent token and the hidden
   `<omo-btw-boundary>` sentinel.
8. Observe the side answer `SIDE-CONTEXT-PROOF`.
9. Submit `second side question` in the same side session.
10. Observe a second `SIDE_CONTEXT_OK` and `SIDE-CONTEXT-PROOF`.
11. Switch to the parent and back with `Ctrl+/`.
12. Close with `Ctrl+C`.
13. Observe the side session is deleted and only the parent remains.

## What was observed

- OpenCode QA common self-check passed.
- OpenCode TUI smoke passed and reported real DB count `7518` unchanged.
- Browser xterm helper self-test passed.
- Final focused suite passed: `44 pass, 0 fail`; the final keymap/controller
  retest passed `12 pass, 0 fail`.
- The full OpenCode source suite completed `8260 pass, 1 skip, 1 fail`. The
  sole failure was the unrelated cmux runner fixture receiving another
  process's `-k` argument instead of its own `__tmux-compat` fixture. Running
  `packages/omo-opencode/src/shared/tmux/runner.test.ts` alone immediately
  passed `9 pass, 0 fail`.
- OpenCode package typecheck passed.
- Full repository typecheck passed.
- Repository-pinned Bun 1.3.12 build passed.
- TUI registration and prompt refs appeared in the OMO runtime log.
- The parent was still busy when the side started.
- The slash autocomplete displayed `/btw` as its first result with the
  description `Start a temporary side conversation without interrupting the
  main turn`.
- The local model logged `SIDE_CONTEXT_OK` twice, proving both consecutive
  model-only requests saw the bounded parent token and the BTW boundary.
- The side transcript persisted only:
  - `first side question`
  - `SIDE-CONTEXT-PROOF`
  - `second side question`
  - `SIDE-CONTEXT-PROOF`
- The parent transcript persisted only:
  - the parent request containing `ALPHA-CONTEXT-42`
  - `PARENT-CONTINUED`
- The parent transcript did not contain either side question or answer.
- The side transcript did not persist `ALPHA-CONTEXT-42`.
- The TUI displayed:
  - `BTW open · ctrl+/ switch` on the parent;
  - `BTW from main · main ready · ctrl+/ switch · ctrl+c close` on the side.
- `Ctrl+/` switched from side to parent and back.
- `Ctrl+C` returned to the parent and deleted the side session.
- The isolated final database contained one session after closure.
- The real OpenCode database remained at `7526` sessions immediately before
  and after final teardown. An earlier self-test recorded `7518` unchanged
  before unrelated shared-host OpenCode activity.
- QA ports `46731` through `46736` had no listeners after cleanup.

## Artifacts

- Browser xterm screenshot with the clean BTW transcript and answer:
  `visual-side/terminal.png`
- Browser xterm terminal text:
  `visual-side/terminal.txt`
- Browser xterm ANSI stream:
  `visual-side/terminal-ansi.txt`
- Browser capture metadata and cleanup receipt:
  `visual-side/metadata.json`
- Local Responses mock:
  `mock-model.mjs`
- Isolated OpenCode server config:
  `sandbox/config/opencode/opencode.json`
- Isolated OpenCode TUI config:
  `sandbox/config/opencode/tui.json`
- API transcript assertions:
  `api-assertions.json`
- Final slash palette observation:
  `final-discoverability.txt`
- Final two-turn, switch, close, and isolation observation:
  `final-live-observations.txt`
- Codex review regression and real-harness re-QA:
  `review-fixes.txt`

## Why this is enough

The tests pin the controller, metadata, request transform, command registration,
prompt slot wiring, and transform integration. The typechecks and build verify
the complete package graph. The real TUI run then exercises the behavior that
source checks cannot prove: starting while the parent is busy, prompt keymap
dispatch, clean side rendering, model-only inherited context, parent isolation,
visible status, route switching, deletion, and host database isolation.

## What was omitted

- No real API key, provider request, auth header, or credential was used.
- Raw environment dumps were not captured.
- The OMO runtime log was inspected for specific BTW lifecycle markers but was
  not copied because it contains unrelated local session activity.
- Failed exploratory visual captures were retained only inside this ignored
  evidence directory and are not cited as passing evidence.

## Remaining limitation

OpenCode does not expose Codex's native split side-thread presentation to TUI
plugins. OMO therefore uses a clean temporary session route with explicit
`Ctrl+/` switching. An unexpected process crash can leave that metadata-marked
temporary session in the session list because a second TUI client cannot safely
decide that another client's side session is stale.

