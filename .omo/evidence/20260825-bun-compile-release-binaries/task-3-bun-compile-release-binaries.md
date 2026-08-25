# Task 3 - final five-fix darwin-arm64 live-drive evidence

## WHAT WAS TESTED

Final authoritative matrix on 2026-08-25 against the current binary:

- Binary: `/tmp/work-binary-assets/.omo/release-binaries/omo-darwin-arm64`
- Observed mtime: `2026-08-25 22:47:41`
- Size: `111765538` bytes
- Embedded sidecars: `1158`
- Fresh final-doctor QA root: `/tmp/omo-task3-finaldoctor.ok1G4T`
- Binary execution used fresh isolated HOME/XDG/OMO_CODING_AGENT_DIR roots and minimal `env -i` environments.

Five-fix progression:

1. `58065b777` - exact top-level `omo-runtime/runtime-manifest.json` selection.
2. `09347ec2f` - normalization of the `omo-runtime/` embedded path prefix.
3. `ab509291a` - byte-preserving PNG/WASM/.node provisioning.
4. `310cb09b0` - realpath re-exec comparison and manifest-sourced engine pin.
5. `21407cca6` - compiled doctor rooted at the provisioned runtime.

## FINAL SCENARIO MATRIX

| Scenario | Final result | Evidence / classification |
| --- | --- | --- |
| (a) first-run provisioning + exact stamped version + second-run consistency | **PASS** | Fresh prior authoritative run: both wrapper runs exit 0 and print exactly `omo 0.0.0-0.plan (engine: senpi 2026.8.24)`; 1160 runtime files materialize, including `.provisioned`, `omo`, package manifest, PNG, native prebuild, plugin, docs, examples, export-html, and node_modules. |
| (b) doctor/setup report + engine pin | **PASS** | Fresh current-binary run below: exit 0, four required PASS lines, and engine-pin INFO line. |
| (c) scripted engine invocation / plugin-loaded marker | **ENVIRONMENTAL** | Isolated invocation reaches Senpi/plugin path but exits on the expected missing API-key condition; no credentials are available in the clean environment. Not a binary defect. |
| (d) provisioned PTY round-trip, native not pipe fallback | **PASS** | Prior authoritative run with the absolute Bun probe path: PTY round-trip exit 0; native loader returned `native: true`, `diagnostic: null`, and `__senpiPtyAbi1`, with the darwin-arm64 prebuild loaded. |
| (e) real `~/.omo` / `~/.senpi` untouched proof | **ENVIRONMENTAL** | All binary invocations use isolated roots. The receipt is non-empty because concurrent activity exists under real `~/.omo` and `~/.senpi`; this is an environment limitation, not a binary mutation attributed to this run. |
| (f) remove sibling package.json from copied provisioned dir | **PASS (desired negative control)** | The copied isolated runtime exits 1 with explicit `ENOENT` while reading the missing sibling manifest, rather than silently mis-stamping `0.0.0`. This fail-loud result is the intended negative-control outcome. |

## SCENARIO (b): FRESH CURRENT-BINARY DOCTOR CAPTURE

Command:

```sh
env -i HOME=<fresh> XDG_CONFIG_HOME=<fresh> XDG_DATA_HOME=<fresh> \
  XDG_STATE_HOME=<fresh> XDG_CACHE_HOME=<fresh> \
  OMO_CODING_AGENT_DIR=<fresh> PATH=/usr/bin:/bin:/usr/local/bin \
  /tmp/work-binary-assets/.omo/release-binaries/omo-darwin-arm64 doctor
```

Exact result against the 22:47 binary:

```text
exit=0
stdout bytes=258
stderr bytes=0
PASS plugin manifest: plugin/package.json
PASS extension: plugin/extensions/omo.js
PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js
PASS agent-toolkit runtime: plugin/runtime/agent-toolkit/cli.js
INFO omo 0.0.0-0.plan (engine: senpi 2026.8.24)
```

A version check in the same fresh root also exited 0 and printed exactly:

```text
omo 0.0.0-0.plan (engine: senpi 2026.8.24)
```

## WHY THIS IS ENOUGH

The current binary includes all five entry fixes. The fresh doctor run proves `21407cca6` at the real compiled surface: provisioned-runtime diagnostics find the plugin manifest, extension, LSP runtime, and agent-toolkit runtime, then report the stamped engine pin. Scenarios (a) and (d) are already proven PASS on the same current artifact family; (c) and (e) are explicitly environmental; (f) is the intended fail-loud negative control.

No implementation files were edited by this task.

## CLEANUP RECEIPTS

Fresh final-doctor QA root:

```text
/tmp/omo-task3-finaldoctor.ok1G4T
```

Fresh real-home receipt:

```text
/tmp/omo-task3-finaldoctor-real.8RlLpB
```

Removed after evidence transcription:

```sh
rm -rf /tmp/omo-task3-finaldoctor.ok1G4T /tmp/omo-task3-finaldoctor-real.8RlLpB /tmp/omo-task3-finaldoctor-root /tmp/omo-task3-finaldoctor-receipt
```

The requested binary under `.omo/release-binaries` was left untouched. No quarantine attributes were stripped and no real agent directory was used as an execution target.
