import en, { type TranslationKey } from "./en"

const overrides: Partial<Record<TranslationKey, string>> = {
  "toast.new_background_task": "Nouvelle tâche en arrière-plan",
  "toast.new_task_executed": "Nouvelle tâche exécutée",
  "toast.task_completed": "Tâche terminée",
  "toast.task_completion_message": "«\u00A0{{description}}\u00A0» terminée en {{duration}}",
  "toast.task_completion_remaining": "En cours\u00A0: {{running}} | En attente\u00A0: {{queued}}",
  "toast.status_queued": "En attente",
  "toast.task_list_running": "En cours ({{count}})\u00A0:",
  "toast.task_list_queued": "En attente ({{count}})\u00A0:",
  "toast.task_list_new": " ← NOUVELLE",
  "toast.fallback_prefix": "[REPLI] Modèle\u00A0: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (hérité du parent)",
  "toast.fallback_system_default": " (repli système par défaut)",
  "toast.fallback_runtime": " (repli à l'exécution)",
}

const locales = {
  ...en,
  ...overrides,
} satisfies Record<TranslationKey, string>

export default locales
