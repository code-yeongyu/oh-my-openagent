# PR #7250 分支重写验证证据（2026-09-02）

## WHAT WAS TESTED

在 worktree `.local-ignore/wt-7250`（分支 `wt-7250`，基于 `origin/dev@1291b02c1`）上：

1. 按序 cherry-pick 六个范围内提交（aaeb1521b / 9bf80ef31 / fa54a0e13 / dc54e196a / 847909fec / 2b85c5eae），无文本冲突。
2. 清洁性核查：`git diff origin/dev..HEAD --name-only`，确认不含任何 team-mode / question-denied-session-permission / team-session-events / team-core/types.ts 路径。
3. 发现语义冲突：dev 已演进（e5ab78a2d 重构 + 6974bbdb1 恢复链访问器），`hook.test.ts` 中两个用户主模型链头测试断言的旧链头 `["anthropic","github-copilot","opencode","vercel"]` 与 dev 当前 `packages/model-core/src/agent-model-requirements.ts:7` 的 sisyphus 链头 `["anthropic","github-copilot","opencode"]` 不一致。决策：功能未上游化（`resolveUserConfiguredPrimary` 在 origin/dev 全仓不存在），保留 847909fec/dc54e196a，仅将两处字面量断言重对齐到 dev 当前链表并注明出处。
4. `bun run typecheck`（tsgo 根 + script + 31 个包）。
5. 三个受影响测试文件的聚焦测试：model-core 分类器、gateway-error 回归、model-fallback hook。

## WHAT WAS OBSERVED

- cherry-pick 全部干净落地（Auto-merging 均成功，无 conflict 标记）。
- diff 文件清单共 13 个：model-core 分类器 ×2、model-fallback hook/controller/测试 ×3、create-session-hooks ×1、gateway 回归测试 ×1、QA 证据 ×6。
- 对齐后聚焦测试：**35 pass / 0 fail**（103 expect），覆盖三个文件。
- typecheck：**exit 0**，无错误。
- 测试对齐提交 `8369c4f93`：`1 file changed, 4 insertions(+), 2 deletions(-)`，仅改 hook.test.ts 两处 providers 数组 + 两处出处注释。

## WHY IT IS ENOUGH

- 维护者阻断意见的两项要求均已满足：(a) Team Mode 无关改动已从 diff 中移除（清洁性核查为零命中）；(b) gateway-error 分类回归与用户主模型链头四条场景（前置、去重、会话链优先、无配置时与基线字节一致）全部通过，断言值直接派生自 dev 当前 requirements 表并在测试内注明出处。
- typecheck 全绿证明与 dev 最新模型核心/会话钩子接线兼容。
- 剩余风险：CI（bun test 全量 + 各平台）未在本地跑全量，由 PR CI 兜底。

## WHAT WAS OMITTED

- 未复制完整测试/typecheck 原始日志（仅摘要），未包含任何 token、凭据或环境变量。
- 未做 live OpenCode TUI/CLI 冒烟：本变更是测试断言与既有修复的 rebase 对齐，运行时行为由聚焦回归测试覆盖；CLI 冒烟证据见既有提交 2b85c5eae 携带的 `.omo/evidence/20260824-gateway-fallback/`。
