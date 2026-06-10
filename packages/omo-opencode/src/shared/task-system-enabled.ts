export interface TaskSystemConfig {
  experimental?: {
    task_system?: boolean
  }
}

export function isTaskSystemEnabled(config: TaskSystemConfig): boolean {
  return config.experimental?.task_system ?? false
}
