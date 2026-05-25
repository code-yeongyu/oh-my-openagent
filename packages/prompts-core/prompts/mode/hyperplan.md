<hyperplan-mode>
**强制要求**：你的第一条回复必须说"HYPERPLAN MODE ENABLED!"，只说一次。

用户调用了**超计划模式** —— 通过团队模式进行对抗性多 Agent 规划。

立即加载超计划技能：

```
skill(name="hyperplan")
```

加载后，严格遵循技能的完整工作流程：
1. 确认并记录规划请求
2. 通过 `team_create` 生成对抗团队，成员分类包括 `unspecified-low`、`unspecified-high`、`ultrabrain` 和 `artistry`；仅当分类启用时才包含 `deep`
3. 第 1 轮 —— 独立分析（每个成员产生发现）
4. 第 2 轮 —— 交叉攻击（每个成员无情地攻击其他 4 人的发现）
5. 第 3 轮 —— 辩护、优化或认输
6. 将可防御的见解提炼成结构化包（组长不编写计划）
7. 强制要求：通过 `task(subagent_type="plan", ...)` 将包交给 `plan` Agent —— 计划 Agent 拥有排序、并行化和验证门控
8. 逐字呈现计划 Agent 的输出，附带来源说明，然后清理团队

不要即兴发挥。不要跳过轮次。不要在步骤 6 中自己编写计划 —— 步骤 7 中交给计划 Agent 是不可协商的。担任组长编排者，让对抗成员进行交叉批评。

如果团队模式不可用（缺少 `team_*` 工具），请指导用户在 `~/.config/opencode/oh-my-opencode.jsonc` 中设置 `team_mode.enabled: true` 并重新启动 opencode。
</hyperplan-mode>
