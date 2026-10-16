import type { ResourceLoader, SettingsManager } from "@code-yeongyu/senpi"

import { senpiBarrel } from "../../lazy/senpi-barrel"

export type ChildResourceLoaderOptions = {
  readonly cwd: string
  readonly agentDir?: string
  readonly settingsManager: SettingsManager
  readonly systemPrompt?: string
}

// Use senpi's own loader as the single source of truth for builtin extensions, but suppress every
// discovered path/resource. This matches a process child launched with --no-extensions while never
// re-running the parent's agentDir/project extensions (including omo-senpi itself) in-process.
export function createChildResourceLoader(options: ChildResourceLoaderOptions): ResourceLoader {
  const senpi = senpiBarrel()
  return new senpi.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir ?? senpi.getAgentDir(),
    settingsManager: options.settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    extensionsOverride: (loaded) => {
      // Process children are launched with --no-ask-user. Set the same builtin flag before the
      // AgentSession consumes the loaded extension set so ask_user remains parent-only.
      loaded.runtime.flagValues.set("no-ask-user", true)
      return loaded
    },
  })
}
