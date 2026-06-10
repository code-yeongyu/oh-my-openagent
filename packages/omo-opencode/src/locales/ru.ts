import en, { type TranslationKey } from "./en"

const overrides: Partial<Record<TranslationKey, string>> = {
  "toast.new_background_task": "Новая фоновая задача",
  "toast.new_task_executed": "Запущена новая задача",
  "toast.task_completed": "Задача завершена",
  "toast.task_completion_message": "\"{{description}}\" завершена за {{duration}}",
  "toast.task_completion_remaining": "Продолжают выполняться: {{running}} | В очереди: {{queued}}",
  "toast.status_queued": "В очереди",
  "toast.task_list_running": "Выполняется ({{count}}):",
  "toast.task_list_queued": "В очереди ({{count}}):",
  "toast.task_list_new": " ← НОВАЯ",
  "toast.fallback_prefix": "[РЕЗЕРВ] Модель: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (унаследовано от родительской задачи)",
  "toast.fallback_system_default": " (системная резервная модель по умолчанию)",
  "toast.fallback_runtime": " (резервная модель времени выполнения)",
  "toast.concurrency_info": " [{{total}}/{{limit}}]",
}

const locales = {
  ...en,
  ...overrides,
} satisfies Record<TranslationKey, string>

export default locales
