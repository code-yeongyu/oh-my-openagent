#!/usr/bin/env bash
# Local CI runner — mirrors .github/workflows/ci.yml exactly
set -euo pipefail

CI_STEPS=0
CI_FAILED=0

step() {
  CI_STEPS=$((CI_STEPS + 1))
  echo "::group::[$CI_STEPS] $*"
}

pass() {
  echo "✅ $*"
  echo "::endgroup::"
}

fail() {
  echo "❌ $*"
  CI_FAILED=$((CI_FAILED + 1))
  echo "::endgroup::"
}

export BUN_INSTALL_ALLOW_SCRIPTS="@ast-grep/napi"

# ------------------------------------------------------------------
# Install dependencies (shared across all CI jobs)
# ------------------------------------------------------------------
step "Install dependencies"
bun install && pass "Install dependencies" || fail "Install dependencies"

# ------------------------------------------------------------------
# Type check  (mirrors ci.yml typecheck job)
# ------------------------------------------------------------------
step "Type check"
bun run typecheck && pass "Type check" || fail "Type check"

# ------------------------------------------------------------------
# Lint  (mirrors ci.yml lint job)
# ------------------------------------------------------------------
step "Lint"
bun run lint && pass "Lint" || fail "Lint"

# ------------------------------------------------------------------
# Mock-heavy tests (isolated)  (mirrors ci.yml test job)
# ------------------------------------------------------------------
step "Mock-heavy tests (isolated) — plugin-handlers"
bun test src/plugin-handlers && pass "plugin-handlers" || fail "plugin-handlers"

step "Mock-heavy tests (isolated) — compaction-context-injector"
bun test src/hooks/compaction-context-injector && pass "compaction-context-injector" || fail "compaction-context-injector"

step "Mock-heavy tests (isolated) — tmux-subagent"
bun test src/features/tmux-subagent && pass "tmux-subagent" || fail "tmux-subagent"

step "Mock-heavy tests (isolated) — individual files"
for test in \
  src/cli/doctor/formatter.test.ts \
  src/cli/doctor/format-default.test.ts \
  src/tools/delegate-agent/sync-executor.test.ts \
  src/tools/delegate-agent/session-creator.test.ts \
  src/features/opencode-skill-loader/loader.test.ts \
  src/features/opencode-skill-loader/agents-skills-global.test.ts \
  src/tools/session-manager/storage.test.ts \
  src/hooks/prometheus-md-only/index.test.ts \
  src/hooks/architect/index.test.ts \
  src/hooks/matrix-loop/index.test.ts \
  src/hooks/start-work/index.test.ts \
  src/hooks/auto-update-checker/hook/background-update-check.test.ts \
  src/hooks/auto-update-checker/hook.test.ts \
  src/features/skill-mcp-manager/manager.test.ts \
  src/features/background-agent/manager.test.ts \
  src/hooks/comment-checker/cli.test.ts \
  src/hooks/comment-checker/hook.apply-patch.test.ts \
  src/hooks/directory-agents-injector/injector.test.ts \
  src/hooks/directory-readme-injector/injector.test.ts \
  src/hooks/rules-injector/injector.test.ts \
  src/hooks/compaction-todo-preserver/index.test.ts \
  src/hooks/preemptive-compaction.test.ts \
  src/tools/lsp/client.test.ts \
  src/tools/skill/tools.test.ts \
  src/features/claude-code-mcp-loader/loader.test.ts \
  src/hooks/anthropic-context-window-limit-recovery/empty-content-recovery-sdk.test.ts \
  src/hooks/anthropic-context-window-limit-recovery/recovery-hook.test.ts \
  src/hooks/anthropic-context-window-limit-recovery/storage.test.ts \
  src/cli/run/integration.test.ts \
  src/cli/run/server-connection.test.ts \
  src/cli/mcp-oauth/login.test.ts \
  src/cli/config-manager/auth-plugins.test.ts \
  src/agents/utils.test.ts \
  src/hooks/task-notepad/hook.test.ts
do
  label="$(basename "$(dirname "$test")")/$(basename "$test")"
  bun test "$test" && pass "$label" || fail "$label"
done

# ------------------------------------------------------------------
# Remaining tests  (mirrors ci.yml remaining-tests step)
# ------------------------------------------------------------------
step "Remaining tests"
find src bin script -name '*.test.ts' -type f \
  | grep -v -F \
    -e 'src/plugin-handlers/' \
    -e 'src/hooks/compaction-context-injector/' \
    -e 'src/features/tmux-subagent/' \
    -e 'src/cli/doctor/formatter.test.ts' \
    -e 'src/cli/doctor/format-default.test.ts' \
    -e 'src/tools/delegate-agent/sync-executor.test.ts' \
    -e 'src/tools/delegate-agent/session-creator.test.ts' \
    -e 'src/features/opencode-skill-loader/loader.test.ts' \
    -e 'src/features/opencode-skill-loader/agents-skills-global.test.ts' \
    -e 'src/tools/session-manager/storage.test.ts' \
    -e 'src/hooks/prometheus-md-only/index.test.ts' \
    -e 'src/hooks/architect/index.test.ts' \
    -e 'src/hooks/matrix-loop/index.test.ts' \
    -e 'src/hooks/start-work/index.test.ts' \
    -e 'src/hooks/auto-update-checker/hook/background-update-check.test.ts' \
    -e 'src/hooks/auto-update-checker/hook.test.ts' \
    -e 'src/features/skill-mcp-manager/manager.test.ts' \
    -e 'src/features/background-agent/manager.test.ts' \
    -e 'src/hooks/comment-checker/cli.test.ts' \
    -e 'src/hooks/comment-checker/hook.apply-patch.test.ts' \
    -e 'src/hooks/directory-agents-injector/injector.test.ts' \
    -e 'src/hooks/directory-readme-injector/injector.test.ts' \
    -e 'src/hooks/rules-injector/injector.test.ts' \
    -e 'src/hooks/compaction-todo-preserver/index.test.ts' \
    -e 'src/hooks/preemptive-compaction.test.ts' \
    -e 'src/tools/lsp/client.test.ts' \
    -e 'src/tools/skill/tools.test.ts' \
    -e 'src/features/claude-code-mcp-loader/loader.test.ts' \
    -e 'src/hooks/anthropic-context-window-limit-recovery/empty-content-recovery-sdk.test.ts' \
    -e 'src/hooks/anthropic-context-window-limit-recovery/recovery-hook.test.ts' \
    -e 'src/hooks/anthropic-context-window-limit-recovery/storage.test.ts' \
    -e 'src/cli/run/integration.test.ts' \
    -e 'src/cli/run/server-connection.test.ts' \
    -e 'src/cli/mcp-oauth/login.test.ts' \
    -e 'src/cli/config-manager/auth-plugins.test.ts' \
    -e 'src/agents/utils.test.ts' \
    -e 'src/hooks/task-notepad/hook.test.ts' \
  | xargs bun test && pass "Remaining tests" || fail "Remaining tests"

# ------------------------------------------------------------------
# Build + verify output  (mirrors ci.yml build job)
# ------------------------------------------------------------------
step "Build"
bun run build && pass "Build" || fail "Build"

step "Verify build output"
if test -f dist/index.js && test -f dist/index.d.ts; then
  pass "Build output verified (dist/index.js + dist/index.d.ts)"
else
  fail "Build output missing"
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "========== CI SUMMARY =========="
echo "Steps: $CI_STEPS, Passed: $((CI_STEPS - CI_FAILED)), Failed: $CI_FAILED"

if [ "$CI_FAILED" -gt 0 ]; then
  exit 1
fi
