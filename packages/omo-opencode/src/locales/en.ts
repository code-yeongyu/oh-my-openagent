const locales = {
  "toast.new_background_task": "New Background Task",
  "toast.new_task_executed": "New Task Executed",
  "toast.task_completed": "Task Completed",
  "toast.task_completion_message": "\"{{description}}\" finished in {{duration}}",
  "toast.task_completion_remaining": "Still running: {{running}} | Queued: {{queued}}",
  "toast.status_queued": "Queued",
  "toast.task_list_running": "Running ({{count}}):",
  "toast.task_list_queued": "Queued ({{count}}):",
  "toast.task_list_new": " ← NEW",
  "toast.fallback_prefix": "[FALLBACK] Model: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (inherited from parent)",
  "toast.fallback_system_default": " (system default fallback)",
  "toast.fallback_runtime": " (runtime fallback)",
  "toast.concurrency_info": " [{{total}}/{{limit}}]",
} as const

export type TranslationKey = keyof typeof locales
export default locales
