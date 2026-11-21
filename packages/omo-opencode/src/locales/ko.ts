import en, { type TranslationKey } from "./en"

const overrides: Partial<Record<TranslationKey, string>> = {
  "toast.new_background_task": "새 백그라운드 작업",
  "toast.new_task_executed": "새 작업을 시작했어요",
  "toast.task_completed": "작업 완료",
  "toast.task_completion_message": '"{{description}}" 작업이 {{duration}} 만에 끝났어요',
  "toast.task_completion_remaining": "아직 실행 중: {{running}} | 대기 중: {{queued}}",
  "toast.status_queued": "대기 중",
  "toast.task_list_running": "실행 중 ({{count}}):",
  "toast.task_list_queued": "대기 중 ({{count}}):",
  "toast.task_list_new": " ← 새 작업",
  "toast.fallback_prefix": "[폴백] 모델: {{model}}{{suffix}}",
  "toast.fallback_inherited": " (상위 작업에서 물려받음)",
  "toast.fallback_system_default": " (시스템 기본 폴백)",
  "toast.fallback_runtime": " (실행 중 폴백)",
}

const locales = {
  ...en,
  ...overrides,
} satisfies Record<TranslationKey, string>

export default locales
