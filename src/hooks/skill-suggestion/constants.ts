export const HOOK_NAME = "skill-suggestion"

/**
 * Skill suggestion mappings - keywords that trigger skill suggestions.
 * Each entry maps trigger keywords to a recommended skill with rationale.
 */
export const SKILL_SUGGESTIONS: Array<{
  skill: string
  keywords: RegExp
  suggestion: string
}> = [
  // NOTE: brainstorming is handled by keyword-detector hook (brainstorm-mode), not here
  {
    skill: "systematic-debugging",
    keywords:
      /\b(debug|fix\s+bug|error|not\s+working|fails|broken|crash|exception|issue|problem|调试|报错|バグ|エラー|gỡ lỗi)\b/i,
    suggestion:
      '💡 Detected debugging task. Consider invoking `skill("systematic-debugging")` for structured root cause analysis.',
  },
  {
    skill: "git-master",
    keywords:
      /\b(commit|rebase|squash|merge|branch|git\s+log|git\s+blame|bisect|cherry-pick|stash|提交|合并|コミット|マージ)\b/i,
    suggestion:
      '💡 Detected git operation. Consider invoking `skill("git-master")` for atomic commits and safe git workflows.',
  },
  {
    skill: "frontend-ui-ux",
    keywords:
      /\b(ui|ux|styling|css|layout|responsive|animation|design\s+system|component|tailwind|界面|样式|スタイル|レイアウト)\b/i,
    suggestion:
      '💡 Detected UI/UX work. Consider invoking `skill("frontend-ui-ux")` for design-first implementation.',
  },
  {
    skill: "tdd",
    keywords:
      /\b(test|tdd|unit\s+test|spec|test-driven|red-green|测试|テスト|kiểm tra)\b/i,
    suggestion:
      '💡 Detected testing work. Consider invoking `skill("tdd")` for RED-GREEN-REFACTOR workflow.',
  },
  {
    skill: "creating-changes",
    keywords:
      /\b(plan|design\s+doc|architecture|spec|requirement|规划|设计文档|仕様|計画)\b/i,
    suggestion:
      '💡 Detected planning work. Consider invoking `skill("creating-changes")` to write design.md and tasks.md.',
  },
  {
    skill: "playwright",
    keywords:
      /\b(browser|screenshot|scrape|web\s+test|e2e|end-to-end|automation|浏览器|截图|ブラウザ|スクリーンショット)\b/i,
    suggestion:
      '💡 Detected browser automation task. Consider invoking `skill("playwright")` for browser interactions.',
  },
]

/**
 * Skills that should not be suggested if already mentioned in the prompt.
 */
export const SKILL_MENTION_PATTERNS: Record<string, RegExp> = {
  // brainstorming handled by keyword-detector hook
  "systematic-debugging": /skill\s*\(\s*["']systematic-debugging["']\s*\)|\/systematic-debugging/i,
  "git-master": /skill\s*\(\s*["']git-master["']\s*\)|\/git-master/i,
  "frontend-ui-ux": /skill\s*\(\s*["']frontend-ui-ux["']\s*\)|\/frontend-ui-ux/i,
  tdd: /skill\s*\(\s*["']tdd["']\s*\)|\/tdd/i,
  "creating-changes": /skill\s*\(\s*["']creating-changes["']\s*\)|\/creating-changes/i,
  playwright: /skill\s*\(\s*["']playwright["']\s*\)|\/playwright/i,
}
