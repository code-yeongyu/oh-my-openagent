import en, { type TranslationKey } from "./en"

const overrides: Partial<Record<TranslationKey, string>> = {
  "toast.new_background_task": "新后台任务",
  "toast.new_task_executed": "新任务已执行",
  "toast.task_completed": "任务完成",
  "toast.task_completion_message": "\"{{description}}\" 完成，耗时 {{duration}}",
  "toast.task_completion_remaining": "仍在运行: {{running}} | 排队中: {{queued}}",
  "toast.status_queued": "排队中",
  "toast.task_list_running": "运行中 ({{count}}):",
  "toast.task_list_queued": "排队中 ({{count}}):",
  "toast.task_list_new": " ← 新任务",
  "toast.fallback_prefix": "[回退] 模型: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (继承自父级)",
  "toast.fallback_system_default": " (系统默认回退)",
  "toast.fallback_runtime": " (运行时回退)",
  "toast.concurrency_info": " [{{total}}/{{limit}}]",
}

const locales = {
  ...en,
  ...overrides,
} satisfies Record<TranslationKey, string>

export default locales
