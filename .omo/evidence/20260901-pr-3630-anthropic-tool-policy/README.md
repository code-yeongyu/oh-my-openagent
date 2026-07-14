PR #3630 Anthropic nested-delegation policy QA
UTC: 2026-09-01T04:39:15Z

Verified behavior:
- effective provider policy canonicalizes provider IDs
- explicit child model overrides inherited parent model
- omitted child model inherits Anthropic and disables call_omo_agent
- omitted child model inherits non-Anthropic and keeps call_omo_agent enabled
- launch, resume, continuation, fallback, sync prompt, and bootstrap paths use the shared policy

Commands and observed results:
- bun test targeted 7 files: 389 pass, 0 fail, 1072 expectations
- bun run typecheck:packages: exit 0
- bun run build: exit 0
- opencode-qa common.sh --self-check: all isolation/dependency checks passed

Limitation:
- A real Anthropic billing-error replay was not run because no isolated Anthropic credential was available in this worktree. Runtime policy is covered through the actual prompt-body construction paths with deterministic tests.
