# Curated-agent correction: observations

## TDD and mutation observations

- Disabled plus explicit model initially returned a resolved plan without persona/tool policy; the new planner case now returns `unknown_target`.
- A configured Explore process override initially reached the RPC path; the engine now pins curated names after overlay and keeps custom-agent process mode unchanged.
- Senpi's ordinary bash created a probe file in the rejection reproduction. Curated sessions now receive the schema-constrained broker; unit and live mutation attempts are rejected.
- The original mtime checker failed all new content-freshness cases. The final five build tests cover mtime independence, body tamper, stale source marker, whitespace normalization, and transitive senpi-task inclusion.
- Mutating the mirrored fallback table, record parser, or root export made its corresponding regression test fail before restoration.
- The disabled same-name category case was RED at 10 pass / 1 fail and GREEN at 11 pass / 0 fail.

## Final gate observations

- Both scoped typechecks exited 0.
- `bun test packages/senpi-task packages/omo-senpi`: 1,014 pass, 0 fail, 2 snapshots, 3,422 expectations.
- `bun run test:senpi`: 259 pass, 0 fail, 1 snapshot, 813 expectations.
- Markdown link audit: 16 pass, 0 fail.
- Build verifier tests: 5 pass, 0 fail.
- Final `build-extension.mjs --check`: exit 0; the generated bundle also passes the 700,000-byte package budget.

## Final live observations

- Curated driver: 18 checks PASS, including `bash_read_succeeded`, `bash_mutation_rejected`, unchanged probe bytes, absent direct/bash forbidden files, and no QA-attributed real Senpi path.
- Baseline driver: 12 checks PASS with zero leaked PIDs and no QA-attributed real Senpi path.
- Concurrent host sessions changed during both snapshots. Their paths are retained in the JSON artifacts and classified separately; the whole-directory digest is therefore honestly recorded as changed.
