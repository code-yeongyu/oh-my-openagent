# Release root-cause verification (#8209)

## Scope and observations

Only release automation changes; no harness runtime or installer behavior changes. No live npm writes, tag/release mutations, or changes to the running beta.62 workflow.

- `bun test script/release-version.test.ts script/preflight-trust.test.ts`: initial RED missing new modules (`red.log`), followed by behavioral RED for namespace channel escape and explicit HTTP 404 misconfiguration (`red-classification.log`).
- Related suite: `bun test script/release-version.test.ts script/preflight-trust.test.ts script/publish*test.ts script/omo-ai-publish-shape.test.ts script/ci-job-summary-workflow.test.ts`: **96 pass, 0 fail**, 18 files (`green.log`). Tests exercise namespace separation, actual metadata shell outputs and validation before registry calls, real local HTTP POST retries, transport/429/503 recovery, retry exhaustion, 400/401/403 fail-fast, explicit versus ambiguous 404, credential redaction, and existing release guards.
- `bun run typecheck:script`: passed (`typecheck.log`). Node syntax checks passed for both new .mjs scripts; git diff whitespace check passed.
- LSP: TypeScript files/declarations had no errors or warnings (Bun async matcher awaits produce type-only hints). release-version.mjs had no diagnostics; preflight-trust.mjs freshness requests timed out, so Node syntax validation and executable tests provide its validation. YAML LSP unavailable; workflow validator recorded separately. Markdown has no configured language server.

## Manual real-surface QA

`manual-qa.log` records the actual workflow's preflight shell executed under bash -e, invoking the shipped Node CLI. A local HTTP server issued dummy GitHub OIDC tokens and handled npm exchange requests. A Node preload redirected only the npm hostname to the local fixture; production script logic was unmodified.

1. LazyCodex-only package selection requested only lazycodex-ai. First exchange returned HTTP 503, the production backoff retried, second returned HTTP 201, and the process exited 0.
2. HTTP 403 exited 1 after exactly one exchange. The first diagnostic named lazycodex-ai and HTTP 403, followed by the setup URL. Neither dummy OIDC nor issued npm tokens appeared in output.
3. The release-version CLI emitted the exact isolated version and beta channel.
4. The local publish --prepare-only entrypoint rejected an isolated LazyCodex version before reads or writes.

The HTTP fixture checked request path and Authorization header. Child exit and server lifecycle were awaited by exact events with bounded timeouts, not sleeps/polling. Unit backoff tests use an injected clock-free delay recorder.

## Historical evidence

- Run 34733540565 attempt 1, job 103660748115: 22 OK packages through oh-my-openagent-linux-arm64-musl, then curl exit 35. The next package in the workflow is oh-my-opencode-windows-x64. TLS connection failure is established; specific TLS text/npm HTTP status/body was discarded by curl -s plus bash -e and cannot be recovered. Setup guidance in the echoed script was not an executed failure report.
- beta.57 run 34703151137: identical LazyCodex version collision.
- beta.58 run 34703416398 / CI job 103579294045: kibitzer retention test clock mismatch at observe.test.ts:356, already fixed on dev using f.clock.now (prior investigation #8199).
- beta.59 run 34704261620 cancelled; #8201 owner comment states dev advanced and prepared tree was stale/conflicting. Existing freshness protection worked.

## Omitted / residual risk

Raw remote job logs and credentials are not committed; local paths are redacted. No live trusted-publisher OIDC exchange is possible outside GitHub Actions, and no new release was dispatched. Persistent registry outages still fail closed after six attempts. Historical consumed ordinary versions remain immutable. CI/build/merge results are recorded on the PR and issue.
