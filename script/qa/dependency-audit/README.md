# Dependency audit

QA-only capture and comparison for the native release dependency diet. Requires Bun 1.4.2, Node >=24, hyperfine, installed repository dependencies, and `gh` for the best-effort release inventory. Run acceptance commands on the designated remote test host, not on the orchestration host.

```sh
bun script/qa/dependency-audit-capture.ts --phase baseline --binary "$BIN" --out "$BASELINE"
bun script/qa/dependency-audit-capture.ts --phase post --binary "$POST_BIN" --out "$POST"
bun script/qa/dependency-audit-compare.ts --baseline "$BASELINE" --post "$POST" --gate p0
bun test script/qa/dependency-audit-capture.test.ts
bunx --no-install tsgo --noEmit -p script/qa/tsconfig.json
```

`--case` accepts `bytes`, `graph`, `startup`, `rpc`, `extension`, `webfetch`, `photon`, `changelog`, `providers`, `skills`, or `bytes-targets`. Each is independently runnable. Capture exits zero when recording completes, including recorded baseline failures; it does not mean every probe passed. Check each row's `pass`/`exitCode`, or use compare, which exits nonzero for a failed gate or malformed/incomplete receipts. A partial capture cannot satisfy a full compare.

Each case copies and hashes the supplied binary before launch, provisions once into a fresh HOME, uses isolated USERPROFILE/XDG/agent directories, and removes its sandbox in `finally`. The extension and its helper/PNG are copied outside the checkout so installed packages cannot accidentally satisfy compiled-loader imports. Process environments are allowlisted; only fake credentials enter the audited process. Offline mode and telemetry opt-outs are set. Background memory automation is disabled in the isolated config, while the shipped plugin remains loaded for the startup benchmark (no `--no-extensions`). Fixtures bind only loopback ephemeral ports. Public-network access is limited to the explicitly requested GitHub release-asset acquisition; those downloads are never executed.

Receipts contain command, hashed machine identity, Bun/Node versions, exit status, timestamp, artifact hash, observables, and cleanup. Ephemeral paths and loopback ports are normalized. `graph-artifacts/meta.json` is retained; graph capture reads the current release argument array, removes compile-only flags, changes the compile target to `bun`, and uses Bun 1.4.2's `--metafile=PATH` syntax. An unrecognized release argument expression fails rather than silently drifting. This graph describes the installed checkout, not a reconstruction of the immutable audited binary's source tree.

## Gates

- Native darwin-arm64: P0 <=104,857,600 bytes; P1 <=94,371,840 bytes.
- Other targets: <=80% of their own available baseline and <=157,286,400 bytes. No baseline means ceiling only.
- Engine graph: >=1,000 modules, never an exact pinned count.
- Startup: 30 successful hyperfine runs after 3 warmups, for both version and one-shot. Same machine and Bun version. Limit = baseline mean * 1.10 (version) or * 1.15 (one-shot), plus `3 * sqrt(baseline.stddev^2 / 30 + post.stddev^2 / 30)`.
- RPC: two distinct routing handles and distinct correctly routed sentinels, reattachment, and worker teardown. Extension identity is tested in classic and multi modes, not with `typeof`.
- Webfetch: converted markdown/text for three fixtures. Comparison permits equivalent relative/absolute link targets but not content changes.
- Photon: 800x400, resized bytes, independently decoded by Bun.Image.
- Providers: six terminal assistant results. P1 requires an observed local request and authentication failure, never module resolution or network failure. P0 permits only the baseline's known module-resolution class pending provider registration.
- Skills: exact sorted path/size/SHA256 manifest equality. An intentional approved skill change needs an explicitly reviewed reference manifest; this harness never auto-accepts it.

## Baseline provenance and known failure

`fixtures/dependency-audit/baseline-76e54b0-806f8e0/` records the exact audited dev artifact, 130,850,802 bytes, SHA-256 `c593321c06beacd0af1a94cda7a93fc5d76608e0f62efeb7fc5bf324c6059d76`. It is copied, never rebuilt. The release-asset size inventory is separate: the matching published release is not byte-identical to that dev artifact.

All three audited provider modules fail to resolve in both classic and shared-session isolates. This is the expected provider RED.

The audited dev launcher also omits `brand.changelog.version`. `/changelog` renders the shipped entries, but the engine suppresses startup what's-new even after seeding `changelogSeen.omo` to the previous shipped version. The receipt keeps `entriesMatchShipped: true`, `whatsNew: false`, and `pass: false`. Comparison deliberately fails that contract; no baseline exemption or production patch is hidden here.

Bun's PTY API was verified on the test host before capture: `data(terminal, bytes)` received a `Terminal` and a `Buffer` (Uint8Array). PTY EOF status 0 was distinct from a deliberately nonzero child exit 7. The harness captures the real byte stream; it uses neither tmux nor a screenshot surrogate.
