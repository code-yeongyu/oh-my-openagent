# 提交 PR 到 oh-my-opencode

## 当前状态

✅ 代码已完成并提交到本地分支 `feature/custom-notification-script`
✅ Commit 信息已写好
⏳ 等待推送到 GitHub 并创建 PR

## 提交步骤

### 1. Fork 仓库

1. 访问 https://github.com/code-yeongyu/oh-my-opencode
2. 点击右上角的 **Fork** 按钮
3. Fork 到你的 GitHub 账号

### 2. 推送代码

Fork 完成后，在终端执行：

```bash
cd ~/code/opensource/oh-my-opencode

# 添加你的 fork 作为远程仓库（如果还没添加）
git remote add fork https://github.com/apple-ouyang/oh-my-opencode.git

# 推送分支
git push -u fork feature/custom-notification-script
```

### 3. 创建 Pull Request

1. 访问你的 fork：https://github.com/apple-ouyang/oh-my-opencode
2. 会看到提示 "Compare & pull request"，点击它
3. 或者点击 "Pull requests" → "New pull request"
4. 选择：
   - base repository: `code-yeongyu/oh-my-opencode`
   - base: `dev`
   - head repository: `apple-ouyang/oh-my-opencode`
   - compare: `feature/custom-notification-script`

### 4. 填写 PR 信息

**标题**：
```
feat(notification): Support custom notification script (compatible with Claude Code hooks)
```

**描述**：
```markdown
## Summary

Add support for custom notification scripts, fully compatible with Claude Code's hooks system design.

## Motivation

Users want to customize notification behavior, such as:
- Display project directory name in notification title
- Play custom sounds
- Send notifications to external services (Telegram, Slack, etc.)
- Use the same notification script across Claude Code and OpenCode

## Changes

### Core Implementation

- **Extended notification schema**: Added `script`, `playSound`, `soundPath` config fields
- **Created script executor**: New module `session-notification-script-executor.ts`
- **Integrated script execution**: Modified `session-notification.ts` to call custom scripts at three notification points (idle, permission, question)
- **Pass user config**: Modified `create-session-hooks.ts` to pass user config to notification system

### Documentation & Examples

- **Example script**: `examples/notification.sh` demonstrates usage
- **User guide**: `docs/custom-notification-script.md` explains configuration
- **Testing guide**: `docs/testing-guide.md` for local testing

## Configuration Example

```json
{
  "notification": {
    "force_enable": true,
    "script": "~/.config/opencode/notification.sh"
  }
}
```

## Script Interface

- **Arguments**: `<script_path> <hook_type>` (idle/permission/question)
- **stdin**: JSON data (type, sessionID, projectDir, title, message)
- **Environment variables**: `OPENCODE_PROJECT_DIR`, `OPENCODE_SESSION_ID`

## Backward Compatibility

- If `script` is not configured, the built-in notification system is used
- Existing `playSound` and `soundPath` configs continue to work

## Testing

Manual testing of the script executor was successful. Full integration testing will be done after merge.

## Related Issues

Closes #XXX (if there's a related issue)
```

### 5. 提交 PR

点击 "Create pull request" 按钮。

## PR 提交后

1. 等待 CI 检查通过
2. 等待维护者 review
3. 根据反馈修改代码（如果需要）
4. 合并后，官方会发布新版本

## 本地修改记录

```
8 files changed, 441 insertions(+), 16 deletions(-)

Modified:
- assets/oh-my-opencode.schema.json
- src/config/schema/notification.ts
- src/hooks/session-notification.ts
- src/plugin/hooks/create-session-hooks.ts

Added:
- docs/custom-notification-script.md
- docs/testing-guide.md
- examples/notification.sh
- src/hooks/session-notification-script-executor.ts
```

## 如果需要修改

```bash
cd ~/code/opensource/oh-my-opencode

# 修改代码
# ...

# 提交修改
git add .
git commit -m "fix: 修复说明"

# 推送到 fork
git push fork feature/custom-notification-script
```

PR 会自动更新。
