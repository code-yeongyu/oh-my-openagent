export interface SisyphusTaskArgs {
  description: string
  prompt: string
  category?: string
  subagent_type?: string
  background: boolean
  resume?: string
  skills?: string[]
}
