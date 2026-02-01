# Reference: subagent-driven-development

## Codex 协作

在 Subagent 模式下，Codex 可作为代码细节专家:

- **主 Agent (Claude Code)**: 总体协调、架构决策
- **Subagent (Codex)**: 具体代码实现、单元测试编写

### 调用方式

调用 `skill("collaborating-with-codex")` 即可，skill 会指导如何与 Codex 协作。

### 注意事项

- Codex 仅提供参考，需独立判断
- 可以质疑 Codex 的建议
- 默认使用 read-only 模式

## Session Management

- Keep separate sessions for different purposes
- Track SESSION_IDs in `.sisyphus/boulder.json`
- Don't mix planning and implementation sessions

## Anti-Patterns

❌ **Blind acceptance**: Taking subagent output without review
❌ **Context loss**: Not providing enough context to subagent
❌ **Micromanagement**: Giving too granular tasks that lose coherence
❌ **Session chaos**: Using same session for unrelated tasks

## Best Practices

✅ **Clear boundaries**: Define what each agent handles
✅ **Independent thinking**: Question and validate subagent suggestions
✅ **Documentation**: Track which agent contributed what
✅ **Incremental integration**: Integrate small pieces, test frequently
