import en, { type TranslationKey } from "./en"

const overrides: Partial<Record<TranslationKey, string>> = {
  "toast.new_background_task": "Новая фоновая задача",
  "toast.new_task_executed": "Новая задача запущена",
  "toast.task_completed": "Задача завершена",
  "toast.task_completion_message": "\"{{description}}\" завершена за {{duration}}",
  "toast.task_completion_remaining": "Ещё выполняется: {{running}} | В очереди: {{queued}}",
  "toast.status_queued": "В очереди",
  "toast.task_list_running": "Выполняется ({{count}}):",
  "toast.task_list_queued": "В очереди ({{count}}):",
  "toast.task_list_new": " ← НОВАЯ",
  "toast.fallback_prefix": "[ФОЛБЭК] Модель: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (унаследовано от родителя)",
  "toast.fallback_system_default": " (системный фолбэк по умолчанию)",
  "toast.fallback_runtime": " (runtime-фолбэк)",
  "toast.concurrency_info": " [{{total}}/{{limit}}]",
}

const locales = {
  ...en,
  ...overrides,
} satisfies Record<TranslationKey, string>

export default locales
