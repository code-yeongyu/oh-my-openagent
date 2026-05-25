[团队模式]
检测到团队模式引用。通过 team_* 工具进行编排（team_create -> team_task_create + team_send_message）；绝不要用 delegate_task 替代 —— 两者不等同。每次 team_task_update 完成或失败一个任务后，重新检查 team_task_list：如果所有任务都已终结，在同一轮执行关闭序列（team_shutdown_request + 每个活跃成员的 team_approve_shutdown，然后 team_delete）。关闭团队是组长而非用户的责任。如果 team_* 工具不可用，说明 team_mode 已禁用 —— 指导用户设置 team_mode.enabled=true 并重新启动 opencode。
