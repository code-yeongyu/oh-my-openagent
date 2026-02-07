const FALLBACK_TRIGGERS: Record<string, string[]> = {
  "systematic-debugging": ["调试", "排障", "故障排查"],
  "git-master": ["提交", "回滚", "变基"],
  playwright: ["浏览器", "截图", "抓取", "自动化"],
  "archiving-changes": ["归档", "存档", "保存变更"],
  "livestream-playbook": ["直播", "直播运营", "直播话术"],
  "database-optimization": ["数据库优化", "查询优化", "慢查询"],
  "security-audit": ["安全审计", "安全漏洞"],
}

export function mergeFallbackTriggers(skillName: string, triggers: string[]): string[] {
  const fallback = FALLBACK_TRIGGERS[skillName]
  if (!fallback || fallback.length === 0) {
    return triggers
  }

  const normalized = new Set(
    triggers.map((trigger) => trigger.trim()).filter((trigger) => trigger.length > 0)
  )
  const hasFallback = fallback.some((trigger) => normalized.has(trigger))
  if (hasFallback) {
    return [...normalized]
  }

  const merged = [...triggers, ...fallback]
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0)

  return [...new Set(merged)]
}
