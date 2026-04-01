# OpenCode 实验性 LSP 集成 - 使用指南

## 这是什么？

Oh-My-OpenCode 现在支持使用 OpenCode 内置的统一 LSP 工具，而不是我们自己的自定义实现。

**简单来说**：打开一个开关，你就能用上 OpenCode 官方的 LSP 功能，减少维护负担，还能获得更多特性。

## 为什么要用？

### 优势
- ✅ **更多功能**: 获得悬停提示 (hover)、跳转到实现 (go to implementation)、调用层级 (call hierarchy)
- ✅ **更少维护**: 不需要维护自定义 LSP 代码，自动享受 OpenCode 上游改进
- ✅ **更好稳定性**: OpenCode 官方实现经过更广泛的测试

### 权衡
- ⚠️ **实验性功能**: OpenCode 的 LSP 工具目前还是实验性的
- ⚠️ **部分工具保留**: `lsp_diagnostics`、`lsp_symbols`、`lsp_prepare_rename`、`lsp_rename` 仍然使用 oh-my-opencode 的实现（因为 OpenCode 还不支持）

## 如何启用？

### 第一步：配置 OpenCode 环境变量（**必须**）

这一步是**强制的**。OpenCode 源码中，`lsp` 工具只有在 flag 为 true 时才会注册：

```typescript
// OpenCode 内部代码 (packages/opencode/src/tool/registry.ts)
...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
```

**没有这个环境变量，`lsp` 工具根本不存在，AI 无法调用它。**

```bash
# 推荐：只启用 LSP 工具（影响面小）
export OPENCODE_EXPERIMENTAL_LSP_TOOL=true

# 或者：启用所有实验性功能（会同时启用 plan mode、workspaces 等其他功能）
export OPENCODE_EXPERIMENTAL=true
```

**macOS/Linux 永久设置**：
```bash
echo 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' >> ~/.zshrc
source ~/.zshrc
```

### 第二步：配置 oh-my-opencode

编辑你的配置文件（以下任一）：
- 项目级: `.opencode/oh-my-opencode.json`
- 用户级: `~/.config/opencode/oh-my-opencode.json`

添加以下配置：

```json
{
  "lsp": {
    "useOpenCodeExperimental": true
  }
}
```

### 第三步：重启 OpenCode

```bash
# 完全退出 OpenCode 后重新启动
opencode
```

## 发生了什么变化？

### 被替换的工具
启用后，以下工具会被 OpenCode 的统一 `lsp` 工具替代：

| 旧工具 | 新工具 | 功能 |
|--------|--------|------|
| `lsp_goto_definition` | OpenCode 的 `lsp` (operation: `goToDefinition`) | 跳转到定义 |
| `lsp_find_references` | OpenCode 的 `lsp` (operation: `findReferences`) | 查找所有引用 |

### 保留的工具
以下工具继续使用 oh-my-opencode 的实现（OpenCode 暂不支持）：

- `lsp_symbols` - 文档大纲 / 工作区符号搜索
- `lsp_diagnostics` - 获取错误和警告
- `lsp_prepare_rename` - 验证重命名操作
- `lsp_rename` - 跨工作区重命名符号

### 新增功能
OpenCode 的 `lsp` 工具额外提供：

- **hover**: 悬停显示符号信息
- **goToImplementation**: 跳转到接口实现
- **prepareCallHierarchy / incomingCalls / outgoingCalls**: 调用层级分析

## 如何验证是否生效？

### 方法 1: 检查工具列表
启动 OpenCode 后，在聊天中问 AI：
```
列出所有可用的 LSP 工具
```

**预期结果**：
- ✅ 应该看到 `lsp` 工具（OpenCode 的统一工具）
- ❌ 不应该看到 `lsp_goto_definition` 和 `lsp_find_references`
- ✅ 应该看到 `lsp_symbols`、`lsp_diagnostics`、`lsp_prepare_rename`、`lsp_rename`

### 方法 2: 实际测试
在 OpenCode 中打开一个项目，要求 AI：
```
使用 LSP 跳转到 MyFunction 的定义
```

AI 应该使用 OpenCode 的 `lsp` 工具而不是 `lsp_goto_definition`。

## 遇到问题怎么办？

### 问题 1: `lsp` 工具不可用

**症状**: 启用后没有看到 OpenCode 的 `lsp` 工具

**解决方案**:
1. 确认环境变量已设置：
   ```bash
   echo $OPENCODE_EXPERIMENTAL_LSP_TOOL
   # 应该输出: true
   ```

2. 完全重启 OpenCode（不是重新加载窗口）

3. 检查 OpenCode 版本：
   ```bash
   opencode --version
   ```
   确保版本 >= 1.0.150

### 问题 2: `lsp_goto_definition` 消失了

**症状**: 启用后找不到 `lsp_goto_definition` 工具

**这是正常的！** 该工具已被 OpenCode 的 `lsp` 工具替代。AI 会自动使用新工具。

### 问题 3: Workspace Symbol 搜索不工作

**已知问题**: OpenCode 的 `workspaceSymbol` 实现有 bug（硬编码空查询字符串）。

**解决方案**: 使用 oh-my-opencode 的 `lsp_symbols` 工具（我们保留了它）：
```
使用 lsp_symbols 在工作区中搜索符号 "MyClass"
```

## 如何回滚？

如果遇到问题，可以随时切换回自定义 LSP 工具：

### 方式 1: 配置文件回滚
```json
{
  "lsp": {
    "useOpenCodeExperimental": false
  }
}
```

### 方式 2: 删除配置（使用默认值）
直接删除 `lsp` 配置段，默认就是 `false`。

### 重启 OpenCode
```bash
# 完全退出后重启
opencode
```

## 版本规划

| 版本 | 默认值 | 说明 |
|------|--------|------|
| **v3.5.0** (当前) | `false` | 功能标志可用，默认关闭，邀请 beta 测试 |
| **v3.6.0** (计划) | `true` | 默认启用，可以选择退出 |
| **v3.7.0** (计划) | 强制启用 | 完全移除自定义 LSP 工具，配置标志无效 |

**建议**:
- 现在就测试 `useOpenCodeExperimental: true`
- 发现问题及时反馈到 GitHub Issues
- 在 v3.7.0 之前确保你的工作流兼容

## 示例配置

### 最小配置
```json
{
  "lsp": {
    "useOpenCodeExperimental": true
  }
}
```

### 完整项目配置示例
```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/dist/oh-my-opencode.schema.json",
  "lsp": {
    "useOpenCodeExperimental": true
  },
  "agents": {
    "sisyphus": {
      "temperature": 0.1
    }
  },
  "disabled_tools": []
}
```

## 常见问题

### Q: 我需要同时设置环境变量和配置文件吗？

**A**: 是的，**两者都必须设置**，各自控制不同的东西：

| 配置项 | 控制什么 | 缺少会怎样 |
|--------|---------|-----------|
| 环境变量 `OPENCODE_EXPERIMENTAL_LSP_TOOL=true` | OpenCode 是否把 `lsp` 工具注册进来 | `lsp` 工具根本不存在，AI 调不到 |
| 配置 `lsp.useOpenCodeExperimental: true` | oh-my-opencode 是否移除自定义的 `lsp_goto_definition` / `lsp_find_references` | 两套工具同时存在，重复浪费 |

推荐用 `OPENCODE_EXPERIMENTAL_LSP_TOOL=true` 而不是 `OPENCODE_EXPERIMENTAL=true`，后者会同时开启所有实验性功能，影响面更大。

### Q: 为什么不是所有 LSP 工具都被替换？

**A**: OpenCode 的 LSP 工具目前不支持：
- `diagnostics` (获取错误/警告)
- `rename` / `prepareRename` (重命名符号)
- `workspaceSymbol` 查询（有 bug）

我们保留了这些工具的自定义实现。

### Q: 性能会更好还是更差？

**A**: 理论上应该相当或更好（OpenCode 官方维护）。如果你发现性能问题，请反馈。

### Q: 我可以只用部分 OpenCode 的 LSP 功能吗？

**A**: 不行，这是全有或全无的开关。要么全用 OpenCode（对于支持的操作），要么全用自定义实现。

### Q: 这会影响我现有的代码吗？

**A**: 不会。这只是改变 AI 使用的工具，不影响你的项目代码。

## 反馈问题

如果遇到 bug 或有建议，请到 GitHub 提交 issue：

📝 **Issue 模板**:
```
标题: [LSP实验性功能] 问题简述

环境:
- oh-my-opencode 版本: (运行 `opencode --version`)
- OpenCode 版本: 
- 操作系统: 
- 配置: lsp.useOpenCodeExperimental = true

问题描述:
(描述你遇到的问题)

复现步骤:
1. 
2. 
3. 

期望行为:
(你期望发生什么)

实际行为:
(实际发生了什么)
```

🔗 **提交到**: https://github.com/code-yeongyu/oh-my-opencode/issues

---

**需要更多帮助？** 加入我们的 Discord 社区: https://discord.gg/PUwSMR9XNk
