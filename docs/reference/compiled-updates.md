# Updates for standalone compiled installs

The installed `omo` executable is a bootstrap. It selects a complete, immutable
runtime generation for each launch. A generation includes its executable,
engine, plugin, native dependencies and manifest. Updating does not restart an
existing session or change the files that session uses.

An eligible interactive standalone launch starts a bounded background check when
the last check is due. Checks normally run at most once every six hours; failures
use persisted backoff. A verified download is staged for a later launch. That
later interactive launch probes the real bundled engine with isolated state and
no credentials before committing the selection. Simultaneous launches continue
with the last committed generation while the probe runs.

`omo update` deliberately resolves, verifies and selects a release through the
same installation transaction. `omo update --dry-run` describes the release and
selection plan without changing the installation. `omo --version` reports the
already selected version locally and never activates a staged candidate.

## User settings

Create `~/.omo/updates/settings.json` with one of these modes:

```json
{ "mode": "auto" }
```

- `auto`: check, stage and activate at the next eligible interactive launch.
- `notify`: check and show the cached update notice; do not download or activate.
- `off`: do not check, download or activate automatically.

`auto` is the default for an established standalone release installation.
`OMO_AUTO_UPDATE=auto|notify|off` overrides the file. Invalid settings disable
automatic mutation. Project settings cannot authorize an installation change.

The effective `OFFLINE` and `SKIP_VERSION_CHECK` flags also disable automatic
updates, including pending activation. Values use the existing OMO, SENPI, then
PI precedence: the first defined value wins, and any nonempty value is true.
An explicitly empty OMO value therefore overrides an inherited SENPI value.
`OFFLINE` also refuses an explicit network update; `SKIP_VERSION_CHECK` permits
an explicitly requested `omo update`.

CI, non-TTY, print, JSON, RPC, internal host/task and development launches do not
implicitly check, download or activate. They use the committed selection, or
remain pinned when started through an explicit generation path. A shared install
can still change selection through another interactive process; reproducible CI
should use a pinned generation or a dedicated install.

## Ownership and recovery

Package-manager installations continue to use their package manager. A failed
ownership query is unknown ownership and cannot authorize standalone mutation.
An installation record is bound to the canonical launcher path, its file
identity, channel and release asset. Replacing or redirecting that launcher
invalidates the old binding.

The launcher keeps the selected and previous-known-good generations, staged
candidates and all live or uncertain process leases. Publication, selection,
lease registration and garbage collection share one coordination protocol.
Legacy version-only runtime directories have no such leases and are retained.
Interrupted transactions recover from a durable journal. A corrupt selected
payload falls back to the recorded verified previous generation.

Failed startup candidates are quarantined by version and digest. A new candidate
can be tried automatically; an explicit update can retry the quarantined
candidate. A user session's nonzero exit or signal does not trigger rollback.

`omo doctor` reports cached policy, ownership, bootstrap, selected, previous and
staged versions, last check and the latest update reason. The effective
installation receipt is refreshed after successful selection.

## Release protocol and bootstrap maintenance

Release binaries declare `updateProtocol` in their embedded runtime manifest.
The build also emits `updateBackwardCompatible`, which is false unless the
release's shared session/config rollback gate has passed and the build is run
with `OMO_RELEASE_ROLLBACK_COMPATIBLE=1`. Protocol support alone does not
authorize an automatic state downgrade.

Downloads use the exact release asset and its `SHA256SUMS` entry before any
candidate code executes. This is the release-integrity contract over HTTPS, not
an independent publisher signature. Version and embedded-manifest probes use an
isolated home and agent directory, followed by an actual engine startup response.

A candidate requiring a newer bootstrap protocol remains staged. Bootstrap
maintenance uses a separate helper after the external bootstrap exits and only
when all of that install's launcher leases have ended. It copies a complete
executable to a sibling temporary file and journals an atomic replacement.
Windows sharing refusal leaves maintenance pending and preserves the committed
selection. Routine compatible runtime activation does not require a bootstrap
replacement.
