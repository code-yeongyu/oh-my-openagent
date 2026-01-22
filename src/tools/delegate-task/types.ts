export interface DelegateTaskArgs {
  description: string
  prompt: string
  category?: string
  subagent_type?: string
  run_in_background: boolean
  resume?: string
  load_skills: string[]
}
