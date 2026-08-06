import type {
  ExtensionRuntime,
  LoadExtensionsResult,
  ResourceLoader,
} from "@code-yeongyu/senpi"

export type MinimalSenpiResourceLoaderOptions = {
  readonly runtime: ExtensionRuntime
}

export function createMinimalSenpiResourceLoader(options: MinimalSenpiResourceLoaderOptions): ResourceLoader {
  const extensionsResult: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: options.runtime,
  }

  return {
    getExtensions() {
      return extensionsResult
    },
    getSkills() {
      return { skills: [], diagnostics: [] }
    },
    getPrompts() {
      return { prompts: [], diagnostics: [] }
    },
    getThemes() {
      return { themes: [], diagnostics: [] }
    },
    getAgentsFiles() {
      return { agentsFiles: [] }
    },
    getSystemPrompt() {
      return undefined
    },
    getAppendSystemPrompt() {
      return []
    },
    extendResources() {},
    async reload() {},
  }
}
