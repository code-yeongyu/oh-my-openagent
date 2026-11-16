### Fixed

- `omo remote interrupt` without `--json` now says what happened to the interrupted turn's background jobs, not only "Interrupted <device>/<session>.". It names the jobs it stopped, gives one line with the reason for each job it could not stop, and on a device whose engine predates the background stop it says those jobs were left running. `--json` is unchanged.

<!-- changes-log: packages/omo-native/changes.md -->
## 2026-11-16 - `omo remote interrupt` names the background jobs it stopped or left running

`remote-render.ts` `sessionVerbLines`: an `interrupt` that stopped a turn adds `Stopped <n> background job(s): <description or id>, ...` and one `Could not stop background job <description or id>: <reason>.` line per failure. A `not_supported` result (an engine before senpi's `interrupt { background }`) adds `Background jobs that turn started were left running: the engine on <label> cannot stop them.`. `interrupted: false` still prints only `Nothing was running on <label>.`. Test: `test/remote-cli.test.ts` "interrupt without --json names the background jobs it stopped or left".
