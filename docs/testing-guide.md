# 本地测试指南

## 测试准备

### 1. 构建项目

```bash
cd ~/code/opensource/oh-my-opencode
bun install
bun run build
```

### 2. 链接本地版本

```bash
cd ~/code/opensource/oh-my-opencode
bun link
```

### 3. 在 OpenCode 配置中使用本地版本

编辑 `~/.config/opencode/opencode.json`，将 oh-my-opencode 版本改为 `link:oh-my-opencode`：

```json
{
  "plugin": [
    "link:oh-my-opencode"
  ]
}
```

或者直接使用命令：

```bash
cd ~/.config/opencode
bun link oh-my-opencode
```

### 4. 配置通知脚本

编辑 `~/.config/opencode/oh-my-opencode.json`：

```json
{
  "notification": {
    "force_enable": true,
    "script": "/tmp/test-opencode-notification.sh"
  }
}
```

## 测试方法

### 方法 1：手动测试脚本

```bash
export OPENCODE_PROJECT_DIR="/Users/admin/code/opensource/oh-my-opencode"
export OPENCODE_SESSION_ID="test-session-123"

echo '{
  "type": "idle",
  "sessionID": "test-123",
  "projectDir": "/Users/admin/code/opensource/oh-my-opencode",
  "title": "OpenCode Test",
  "message": "This is a test notification"
}' | /tmp/test-opencode-notification.sh idle

# 查看日志
cat /tmp/opencode-test-notification.log
```

### 方法 2：在 OpenCode 中测试

1. 打开测试项目：
   ```bash
   cd /tmp/opencode-test-project
   opencode .
   ```

2. 在 OpenCode 中运行一个后台任务，例如：
   ```
   请帮我创建一个简单的 hello.txt 文件
   ```

3. 等待任务完成，观察是否收到通知

4. 检查日志文件：
   ```bash
   cat /tmp/opencode-test-notification.log
   ```

### 方法 3：使用测试项目

测试项目已创建在 `/tmp/opencode-test-project`，包含：
- `.opencode/oh-my-opencode.json`：测试配置
- `README.md`：项目说明

## 验证清单

- [ ] 脚本被正确调用（检查日志文件）
- [ ] 环境变量正确传递（`OPENCODE_PROJECT_DIR`、`OPENCODE_SESSION_ID`）
- [ ] JSON 数据正确传递（type、sessionID、projectDir、title、message）
- [ ] 通知显示正确的标题（包含项目目录名）
- [ ] 通知显示正确的消息
- [ ] 提示音正常播放
- [ ] 三种 hook 类型都能正常工作（idle、permission、question）

## 调试技巧

### 1. 查看日志

```bash
# 查看测试脚本日志
tail -f /tmp/opencode-test-notification.log

# 查看 OpenCode 日志
tail -f ~/.opencode/logs/*.log
```

### 2. 检查脚本是否可执行

```bash
ls -la /tmp/test-opencode-notification.sh
# 应该显示 -rwxr-xr-x
```

### 3. 手动触发通知

```bash
# 测试 idle 通知
echo '{"type":"idle","title":"Test","message":"Idle test"}' | \
  OPENCODE_PROJECT_DIR="$PWD" /tmp/test-opencode-notification.sh idle

# 测试 permission 通知
echo '{"type":"permission","title":"Test","message":"Permission test"}' | \
  OPENCODE_PROJECT_DIR="$PWD" /tmp/test-opencode-notification.sh permission

# 测试 question 通知
echo '{"type":"question","title":"Test","message":"Question test"}' | \
  OPENCODE_PROJECT_DIR="$PWD" /tmp/test-opencode-notification.sh question
```

### 4. 检查配置是否生效

在 OpenCode 中运行：

```typescript
// 检查配置
console.log(pluginConfig.notification)
```

## 常见问题

### Q: 通知没有显示

**A:** 检查：
1. 脚本是否有执行权限
2. 脚本路径是否正确
3. 日志文件是否有错误信息
4. macOS 通知权限是否开启

### Q: 环境变量为空

**A:** 确保 oh-my-opencode 正确传递了环境变量，检查 `session-notification-script-executor.ts` 的实现。

### Q: JSON 解析失败

**A:** 检查脚本中的 `jq` 命令是否正确，确保 JSON 格式正确。

## 清理测试环境

```bash
# 删除测试文件
rm /tmp/test-opencode-notification.sh
rm /tmp/opencode-test-notification.log
rm /tmp/test-oh-my-opencode.json
rm -rf /tmp/opencode-test-project

# 取消链接
cd ~/.config/opencode
bun unlink oh-my-opencode

# 恢复原始配置
# 编辑 ~/.config/opencode/opencode.json，改回原来的版本号
```
