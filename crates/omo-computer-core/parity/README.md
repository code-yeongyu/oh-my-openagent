# Parity ledgers of the computer-use v3 reimplementation

Base: `a96a51d8fce01b3635e1c64d1269f7ba9c48c01d` (the old tree's reference commit of the run). Oracle: `d79bc6cc9abdeab4a93979089dbbdede0268078c` (the commit row 3 imported the oracle fixtures from).

## test-parity-manifest.tsv

One row per old test or drifted oracle fixture, measured at the base. Columns: `unit`, `kind`, `test id`, `status`, `note`.
Every row starts as `pending`; the note carries the source location at the base.

| kind | rows | measured as |
|---|---|---|
| rust | 1522 | every line matching `^\s*#\[(tokio::)?test` under `crates/senpi-desktop-*` (11 crates); id = `<crate>::<module path>::<fn>`, the module path the compiler gives the test: resolved from the target root (`src/lib.rs`, else `src/main.rs`) through every out-of-line `mod x;` declaration, following `#[path = "..."]` mounts by rustc's rules, plus the enclosing inline `mod` blocks, so it reads as `cargo test -- --list` prints it after the crate name. An integration-test target `tests/<t>.rs` or `tests/<t>/main.rs` is its own root and its ids are prefixed `tests::<t>`. One attribute sits in a `macro_rules!` template and is recorded with its `$name` token. |
| vitest | 468 | every `it(` / `test(` call (modifiers such as `.each(...)` included) in `packages/senpi-desktop-*/test/**/*.test.ts` (61 files in 6 packages); id = `<package dir>/<file>::<title>`, unit = the package name |
| bun | 174 | the same, in the 36 `*.test.ts` / `*.test.mjs` / `*.test.js` files under a class B path of the plan's Removal inventory (25 in the old omo-senpi component, the lazy-runtime test, 2 doctor tests, 4 old QA-driver tests, 4 release/workflow script tests); id = `<file>::<title>` |
| fixture | 29 | every file of the four oracle fixture sets that `git diff --name-status <oracle> <base>` reports as added (26) or modified (3); unit and id = the old path |

Total: 2193 rows.

Measurement notes:
- Rust: on a Linux host `git grep -c -E '^\s*#\[(tokio::)?test' <base> -- 'crates/senpi-desktop-*'` sums to 1522, the manifest's rust row count. The ids were checked against `cargo test -- --list` at the base for the lib targets of `senpi-desktop-core`, `-safety` and `-session` and for the `stdio_headless` test target of `senpi-desktop-engine`: every listed test is in the manifest under the same id, and the only manifest ids not listed are three tests compiled out on Linux by `#[cfg(...)]`. The plan's figure of 1,182 was taken at the oracle commit; the old tree kept growing.
- `packages/senpi-desktop-sdk` exists at the base but is not in the plan's Removal inventory (it was added to the old tree after the oracle commit). Its 7 test files match the vitest glob and are in the manifest.
- A title that is a template literal keeps its `${...}` source; a title passed as a variable keeps the expression text. A title that repeats inside one file would carry a ` #<n>` suffix; none does at the base.

A later row sets `status` to `ported:<new test id or case path>`, `superseded:AC-<n>` or `dropped:<reject-table row>` in the pull request that replaces the test or decides the fixture. `bun script/computer-v3-guards.ts --parity` accepts `pending`; `--parity --final` refuses it.

## DEFERRED-LEGS.tsv

Columns `design row`, `leg`, `recorded by row`, `owed to row`, `status` (`owed` | `passed:<test or scenario id>`). Header only at creation; item 14 of the plan's Executor contract says how rows add lines. `--parity --final` refuses a leg still owed to row 74 or earlier.
