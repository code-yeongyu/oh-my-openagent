PR #3630 Anthropic nested-delegation policy QA
UTC: 2026-09-01T05:30:00Z

Verified behavior:
- effective provider policy canonicalizes provider IDs
- explicit child model overrides inherited parent model
- omitted child model inherits Anthropic and disables call_omo_agent
- omitted child model inherits non-Anthropic and keeps call_omo_agent enabled
- launch, resume, continuation, fallback, sync prompt, and bootstrap paths use the shared policy

Commands and observed results:
- bun test targeted 7 files: 257 pass, 0 fail, 822 expectations
- bun run typecheck:packages: exit 0
- bun run build: exit 0
- bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check: all isolation/dependency checks passed
- bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test: health/doc/auth checks passed
- disposable HOME/XDG OpenCode run with this worktree plugin and a local fake provider: exit 0; child requests omitted call_omo_agent; real DB sessions 1814 before and after

Limitations:
- The fake-provider OpenCode run reached the real plugin/session/tool request boundary, but its requested Anthropic child override resolved to non-Anthropic models at the captured wire. It is therefore not a live Anthropic-effective provider proof.
- A real Anthropic billing-error replay was not run because no isolated Anthropic credential was available in this worktree. Runtime policy is covered deterministically through the actual prompt-body and retry-bootstrap construction paths.
- sse-hook-probe.sh --self-test did not complete within 213 seconds and was terminated; server-smoke.sh --self-test passed as the successful isolated server QA surface.
