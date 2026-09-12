# PR 7491 launcher diagnostic review-fix QA

## What was tested

- Added failing-first launcher boundary tests for:
  - shell quoting a session path under a spaced agent directory;
  - suppressing default-store diagnostics when
    `OMO_CODING_AGENT_SESSION_DIR` is active;
  - matching a unique partial session UUID;
  - remaining silent for an ambiguous partial UUID.
- Ran the focused launcher suite and complete omo-native package suite.
- Ran omo-native typecheck and rebuilt the staged native payload.
- Drove the real `packages/omo-native/bin/omo.js` launcher against the pinned
  Senpi engine for the same four behaviors, plus `--help` and `--version`.

## What was observed

- Failing-first focused run: 39 pass, 3 fail. The spaced path was unquoted,
  the environment override still scanned the default store, and the partial
  ID did not find the candidate.
- Corrected focused run: 42 pass, 0 fail, 151 assertions.
- Complete omo-native suite before the dev merge: 250 pass, 0 fail, 734
  assertions across 24 files.
- omo-native typecheck: exit 0.
- `bun run build:omo-native`: exit 0 with all 36 required payload artifacts.
- Real launcher unique partial-ID run printed the mismatched filename/header
  explanation and quoted the path argument containing `spaced agent`.
- Real launcher custom-session-dir run printed no default-store diagnostic.
- Real launcher ambiguous-partial run printed no diagnostic.
- Real launcher help rendered successfully through the pinned engine.
- After merging `upstream/dev@0a5dab201`, the package suite passed again at
  270 pass, 0 fail, 774 assertions across 27 files; typecheck and build
  passed with all 37 required payload artifacts.
- Post-merge real launcher QA repeated all three diagnostic paths.
- Final real version output:
  `omo 5.0.0-0.beta.42 (engine: senpi 2026.9.4-3)`.
- Follow-up separator regression: the focused launcher suite first failed at
  44 pass and 1 fail because `custom_session_id` was truncated to `id`.
- Parsing from the timestamp separator made the focused suite pass at 45
  tests, 0 failures, and 160 assertions.
- The final complete omo-native suite passed at 272 tests, 0 failures, and 780
  assertions across 27 files; typecheck and `build:omo-native` also passed.
- A real launcher run with `--session custom_session_id --version` found the
  underscored filename, reported its mismatched header ID, emitted both safe
  retry forms, and printed version `5.0.0-0.beta.42`.
- Final review added failing-first coverage for a valid header-index match
  hidden behind an unrelated filename and for both sides of the `--`
  option-separator boundary. The first run reported 45 pass and 3 fail.
- The corrected launcher defers the all-header scan to the rare unique
  filename-mismatch path, remains silent when Senpi can resolve a matching
  header, and scans only arguments before `--`. Bun re-exec and the generated
  Bun-global shim now inject Bun's own separator so the user's separator
  survives unchanged.
- Final affected suites passed 85 tests with 0 failures and 252 assertions.
  The complete omo-native suite passed 276 tests with 0 failures and 791
  assertions across 27 files. Typecheck and `build:omo-native` passed.
- Real launcher QA forced the Bun re-exec path. A header-index match produced
  no rejection diagnostic; a prompt-side `--session-dir` did not suppress a
  real pre-separator warning; and prompt-side `--session` text produced no
  warning. Each command exited zero and printed version `5.0.0-0.beta.42`.

## Why this is enough

The tests execute the launcher boundary with a captured child environment and
arguments, including the Node and Bun argument paths. The manual runs use the
actual built launcher and pinned Senpi engine, so they prove the user-visible
stderr guidance, suppression rule, ambiguity handling, separator preservation,
help surface, and version surface rather than only helper logic.

## What was omitted

The full help text, environment dump, optional x-search credential warning,
credentials, and unrelated build progress are omitted. Exact relevant
diagnostic and version output is retained.
