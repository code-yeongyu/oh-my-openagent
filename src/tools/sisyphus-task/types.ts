export interface SisyphusTaskArgs {
  description: string
  prompt: string
  category?: string
  agent?: string
  background: boolean
  resume?: string
  skills?: string[]
}
