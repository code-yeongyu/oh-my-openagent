import type { AgentConfig } from "@opencode-ai/sdk"
import { createEnvContext } from "../env-context"

export function applyEnvironmentContext(config: AgentConfig, directory?: string): AgentConfig {
  if (!directory || !config.prompt) return config
  const envContext = createEnvContext()
  return { ...config, prompt: config.prompt + envContext }
}
