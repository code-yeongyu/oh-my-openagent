# QA 证据：PR #7166 强制回复历史守卫修复

分支：`wt-7166`（基于 `ceb3818fd`，即 PR #7166 当前 head）。本分支此前无任何 QA 证据文件，本文件记录历史守卫修复 + 回归测试的完整证据。

## WHAT WAS TESTED

- 测试命令（均在 worktree `/opt/dev-remote/my-dev/oh-my-openagent/.local-ignore/wt-7166` 内执行）：
  - `bun install --frozen-lockfile`（worktree 独立安装，1198 packages，lockfile 与 ceb3818fd 一致）
  - `bun test packages/omo-opencode/src/features/background-agent/parent-wake-idle-force-reply.test.ts`
  - `bun test packages/omo-opencode/src/features/background-agent/`（全部 60 个测试文件，含 21 个 parent-wake 测试文件）
  - `bun run typecheck`（tsgo --noEmit 根目录 + typecheck:script + 29 个 workspace package tsconfig，退出码 0）
- 被驱动的表面：`ParentWakeNotifier.flushPendingParentWake()` 公共 API → `ParentWakeFlushRunner` → `ParentWakeSessionInspector.shouldDeferForHistory`，SDK client 以测试内 mock 替身注入（`createNotifier` fixture，`@opencode-ai/sdk` client 被 `Object.assign` 覆写 `messages`/`status`/`promptAsync`）。
- 意图证明的行为：维护者审查要求 —— 强制回复快路径（fresh parent activity × idle parent × `forceIdleReply`）在派发回复型 prompt 之前必须先跑 `shouldDeferForHistory`；当会话历史存在 `finish:"tool-calls"` + running tool part（BLOCKED_MESSAGES）时 defer，落入 admit-only noReply deposit，绝不派发回复。

## WHAT WAS OBSERVED

- 目标测试文件：`9 pass / 0 fail`（32 expects），其中 8 个为既有测试，1 个为本次新增交叉场景回归测试：`#given recent parent activity is fresh and history has running tool calls #when flushing an idle forced wake #then the history guard defers the forced reply into an admit-only noReply deposit`。该测试断言：`promptAsyncCalls` 恰 1 次、`body.noReply === true`（admit-only deposit，非回复型）、wake 移出 pending、dispatched tracker 中 `shouldReply === false`。
- 全量 background-agent 目录：`752 pass / 0 fail`（1926 expects，60 文件，25.8s）。既有测试零削弱、零删除：
  - 既有 "fresh activity × SAFE_MESSAGES → 强制回复" 测试（快路径另一侧）仍通过 —— 证明守卫仅在历史真正阻塞时才 defer；
  - 既有 "idle × BLOCKED_MESSAGES（无活动）→ admit-only" 测试仍通过 —— 普通路径行为未变。
- `bun run typecheck` 退出码 0（修复后的代码改动无类型错误）。
- 隔离性证明：本次 QA 未启动任何真实 opencode 进程（纯单元测试 + 类型检查），未触碰真实 `~/.local/share/opencode/opencode.db`，无会话写入。worktree 内使用 `--frozen-lockfile` 独立安装，未污染主检出。
- LSP tsserver 诊断在本 worktree 无法启动（找不到 TypeScript 安装）；以仓库强制的 `tsgo` 全量 typecheck（退出码 0，覆盖两个改动文件）作为类型层证据，强于逐文件 tsserver 诊断。

## WHY IT IS ENOUGH

- 被改行为就是 flush-runner 的派发决策逻辑，纯内存决策、无 IO 副作用依赖；新回归测试通过真实 `ParentWakeNotifier` → `ParentWakeFlushRunner` → 真实 `ParentWakeSessionInspector`（仅 SDK client 为 mock）端到端驱动维护者场景（fresh activity 180s 窗口 × idle 状态 × BLOCKED_MESSAGES × `shouldReply=false` wake），并精确断言 admit-only noReply deposit。
- 新守卫两侧均被钉死：历史阻塞 + fresh activity → deposit（新测试）；历史安全 + fresh activity → 仍强制回复（既有测试）。守卫函数 `getParentWakeSessionHistoryDeferralDecision` 对 BLOCKED_MESSAGES 的 defer 行为本就被既有 "无活动 × blocked history" 测试覆盖，本次仅在快路径复用同一函数。
- opencode-qa skill 的 SSE hook probe / TUI smoke 验证的是事件管道与 TUI 启动，不是这段纯决策逻辑；实时复现维护者场景需要让真实后台任务与真实工具调用竞速，不可确定性复现。本子系统在本 PR 系列的既有证据惯例即为共置单元测试套件 + 全量 typecheck，与之一致。
- 残余回归风险：仅当 mock 与真实 SDK 响应形状漂移时才会失真；`messages` mock 形状沿用该文件既有 fixture（`SessionMessageStub`），与生产 `normalizeSDKResponse` 消费的形状一致。

## WHAT WAS OMITTED

- 未运行真实 opencode harness（理由见上节）；未运行 `gh` 任何写操作；分支未推送（推送由用户亲自批准），故 CI 结果不在本证据范围内。
- 测试原始输出仅为 pass/fail 计数与耗时（已在上面完整转述），无 secrets、无 token、无 env dump 需要脱敏；测试内 mock client 指向 `http://127.0.0.1:1` 不可达地址，不产生真实网络请求。
- `bun test` 运行期间测试基建重建了若干 vendored dist 构件（`packages/omo-codex/plugin/components/codegraph/dist/*`、`packages/omo-senpi/plugin/extensions/*`、`packages/omo-codex/scripts/install-dist/install-local.mjs`），与本改动无关，未纳入提交，保留在 worktree 未暂存区。
